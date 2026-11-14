/**
 * Self-hosted speed-test runner.
 *
 * Cloudflare Workers cannot spawn a proxy core, so real ping / download tests
 * need a local helper. On the self-hosted controller we can start a short-lived
 * sing-box process per node, expose its SOCKS5 inbound on loopback, and use it
 * for both the real ping and the optional download test.
 *
 * The core binary is resolved from TSUB_SPEEDTEST_CORE, or `sing-box` on PATH.
 * This module is only imported by server/index.mjs; the Pages Functions bundle
 * never depends on child_process.
 */

import net from 'node:net';
import tls from 'node:tls';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { urlToClashProxy } from '../functions/utils/url-to-clash.js';
import { buildSingboxOutbound } from '../functions/modules/subscription/builtin-singbox-generator.js';

const DEFAULT_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function remaining(deadline) {
    return Math.max(0, deadline - Date.now());
}

function writeSocket(socket, buffer) {
    return new Promise((resolve, reject) => {
        socket.write(buffer, error => error ? reject(error) : resolve());
    });
}

function connectOnce(host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.removeAllListeners();
            socket.destroy();
            if (error) reject(error);
            else resolve();
        };
        const timer = setTimeout(() => finish(new Error('connect_timeout')), timeoutMs);
        socket.once('connect', () => finish());
        socket.once('error', finish);
    });
}

async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close(() => port ? resolve(port) : reject(new Error('free_port_failed')));
        });
    });
}

class BufferedSocket {
    constructor(socket) {
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        this.error = null;
        this.closed = false;
        this.waiters = new Set();
        this.onData = chunk => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            this.notify();
        };
        this.onError = error => {
            this.error = error;
            this.notify();
        };
        this.onClose = () => {
            this.closed = true;
            this.notify();
        };
        socket.on('data', this.onData);
        socket.on('error', this.onError);
        socket.on('close', this.onClose);
    }

    notify() {
        for (const waiter of [...this.waiters]) waiter();
    }

    wait(timeoutMs) {
        if (this.buffer.length > 0) return Promise.resolve();
        if (this.error) return Promise.reject(this.error);
        if (this.closed) return Promise.reject(new Error('socket_closed'));
        return new Promise((resolve, reject) => {
            const waiter = () => {
                cleanup();
                resolve();
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('timeout'));
            }, timeoutMs);
            const cleanup = () => {
                clearTimeout(timer);
                this.waiters.delete(waiter);
            };
            this.waiters.add(waiter);
        });
    }

    async read(size, timeoutMs) {
        while (this.buffer.length < size) {
            if (this.error) throw this.error;
            if (this.closed) throw new Error('socket_closed');
            await this.wait(timeoutMs);
        }
        const result = this.buffer.subarray(0, size);
        this.buffer = this.buffer.subarray(size);
        return result;
    }

    async readChunk(timeoutMs) {
        if (this.buffer.length === 0) await this.wait(timeoutMs);
        const result = this.buffer;
        this.buffer = Buffer.alloc(0);
        return result;
    }

    detach() {
        this.socket.removeListener('data', this.onData);
        this.socket.removeListener('error', this.onError);
        this.socket.removeListener('close', this.onClose);
        this.waiters.clear();
    }
}

function ipv6ToBuffer(address) {
    let value = String(address).replace(/^\[|\]$/g, '');
    if (value.includes('.')) {
        const separator = value.lastIndexOf(':');
        const v4 = value.slice(separator + 1).split('.').map(Number);
        value = `${value.slice(0, separator + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    }
    const [left, right = ''] = value.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    const missing = Math.max(0, 8 - leftParts.length - rightParts.length);
    const parts = [...leftParts, ...Array(missing).fill('0'), ...rightParts];
    const result = Buffer.alloc(16);
    parts.slice(0, 8).forEach((part, index) => {
        result.writeUInt16BE(Number.parseInt(part, 16) || 0, index * 2);
    });
    return result;
}

function encodeSocksAddress(host) {
    const address = String(host).replace(/^\[|\]$/g, '');
    if (net.isIP(address) === 4) {
        return Buffer.concat([Buffer.from([0x01]), Buffer.from(address.split('.').map(Number))]);
    }
    if (net.isIP(address) === 6) {
        return Buffer.concat([Buffer.from([0x04]), ipv6ToBuffer(address)]);
    }
    const name = Buffer.from(address);
    if (name.length > 255) throw new Error('socks_domain_too_long');
    return Buffer.concat([Buffer.from([0x03, name.length]), name]);
}

async function socks5Connect(reader, socket, host, port, timeoutMs) {
    await writeSocket(socket, Buffer.from([0x05, 0x01, 0x00]));
    const method = await reader.read(2, timeoutMs);
    if (method[0] !== 0x05 || method[1] !== 0x00) throw new Error('socks_auth_rejected');

    const portBuffer = Buffer.alloc(2);
    portBuffer.writeUInt16BE(port, 0);
    await writeSocket(socket, Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00]),
        encodeSocksAddress(host),
        portBuffer
    ]));

    const head = await reader.read(4, timeoutMs);
    if (head[0] !== 0x05 || head[1] !== 0x00) throw new Error(`socks_connect_failed_${head[1]}`);

    if (head[3] === 0x01) await reader.read(4 + 2, timeoutMs);
    else if (head[3] === 0x03) {
        const length = await reader.read(1, timeoutMs);
        await reader.read(length[0] + 2, timeoutMs);
    } else if (head[3] === 0x04) await reader.read(16 + 2, timeoutMs);
    else throw new Error('socks_bad_address_type');
}

function waitForTls(socket, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('tls_timeout'));
        }, timeoutMs);
        socket.once('secureConnect', () => {
            clearTimeout(timer);
            resolve();
        });
        socket.once('error', error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

function downloadLimit(url) {
    const requested = Number.parseInt(url.searchParams.get('bytes') || '', 10);
    if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_DOWNLOAD_BYTES;
    return Math.min(requested, MAX_DOWNLOAD_BYTES);
}

async function requestThroughSocks(proxyPort, urlValue, timeoutMs, options = {}) {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const port = Number.parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);
    const deadline = Date.now() + timeoutMs;
    const startedAt = Date.now();

    let raw = null;
    let socket = null;
    let reader = null;

    try {
        raw = net.connect({ host: '127.0.0.1', port: proxyPort });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('socks_connect_timeout')), remaining(deadline));
            raw.once('connect', () => {
                clearTimeout(timer);
                resolve();
            });
            raw.once('error', error => {
                clearTimeout(timer);
                reject(error);
            });
        });

        reader = new BufferedSocket(raw);
        await socks5Connect(reader, raw, host, port, Math.max(1, remaining(deadline)));

        if (url.protocol === 'https:') {
            reader.detach();
            const secure = tls.connect({
                socket: raw,
                servername: host,
                ALPNProtocols: ['http/1.1']
            });
            await waitForTls(secure, Math.max(1, remaining(deadline)));
            socket = secure;
            reader = new BufferedSocket(secure);
        } else {
            socket = raw;
        }

        const hostHeader = url.port ? `${host}:${url.port}` : host;
        const pathAndQuery = `${url.pathname || '/'}${url.search || ''}`;
        const request = [
            `GET ${pathAndQuery} HTTP/1.1`,
            `Host: ${hostHeader}`,
            'User-Agent: TSub-SpeedTest/1.0',
            'Accept: */*',
            'Connection: close',
            '',
            ''
        ].join('\r\n');
        await writeSocket(socket, Buffer.from(request, 'latin1'));

        const maxBytes = options.maxBytes || 0;
        let header = Buffer.alloc(0);
        let headerEnd = -1;
        let bodyBytes = 0;
        let contentLength = null;
        let firstByteAt = 0;
        let timedOut = false;

        for (;;) {
            const waitMs = remaining(deadline);
            if (waitMs <= 0) {
                timedOut = true;
                break;
            }

            let chunk;
            try {
                chunk = await reader.readChunk(waitMs);
            } catch (error) {
                if (error?.message === 'timeout') {
                    timedOut = true;
                    break;
                }
                if (error?.message === 'socket_closed') break;
                throw error;
            }

            if (!chunk.length) break;
            if (!firstByteAt) firstByteAt = Date.now();

            if (headerEnd < 0) {
                header = Buffer.concat([header, chunk]);
                headerEnd = header.indexOf('\r\n\r\n');
                if (headerEnd >= 0) {
                    const headerText = header.subarray(0, headerEnd).toString('latin1');
                    const match = headerText.match(/\r\ncontent-length:\s*(\d+)/i);
                    if (match) contentLength = Number(match[1]);
                    bodyBytes += Math.max(0, header.length - (headerEnd + 4));
                } else if (header.length > 64 * 1024) {
                    throw new Error('response_header_too_large');
                }
            } else {
                bodyBytes += chunk.length;
            }

            if (options.stopAtFirstByte && (headerEnd >= 0 || header.indexOf('\r\n') >= 0)) break;
            if (contentLength !== null && bodyBytes >= contentLength) break;
            if (maxBytes > 0 && bodyBytes >= maxBytes) break;
        }

        if (!firstByteAt) throw new Error(timedOut ? 'timeout' : 'empty_response');

        const statusLine = header.subarray(0, Math.min(header.length, 64)).toString('latin1');
        if (!/^HTTP\/1\.[01] \d{3}/.test(statusLine)) throw new Error('invalid_http_response');

        return {
            latency: firstByteAt - startedAt,
            bytes: maxBytes > 0 ? Math.min(bodyBytes, maxBytes) : bodyBytes,
            elapsedMs: Math.max(1, Date.now() - firstByteAt),
            timedOut
        };
    } finally {
        try { socket?.destroy(); } catch { /* ignore */ }
        try { raw?.destroy(); } catch { /* ignore */ }
    }
}

function buildCoreConfig(record, proxyPort) {
    const proxy = urlToClashProxy(record?.url);
    if (!proxy) throw new Error('node_url_unparseable');
    const outbound = buildSingboxOutbound(proxy);
    if (!outbound) throw new Error('unsupported_protocol');
    if (outbound.endpoint) throw new Error('wireguard_unsupported');

    const tag = 'tsub-speedtest';
    return {
        log: { level: 'error' },
        inbounds: [{
            type: 'socks',
            tag: 'tsub-speedtest-in',
            listen: '127.0.0.1',
            listen_port: proxyPort
        }],
        outbounds: [{ ...outbound, tag }],
        route: { final: tag }
    };
}

async function openSession(record, options, corePath) {
    const timeoutMs = Math.max(1, Number(options?.timeout) || 8000);
    const proxyPort = await getFreePort();
    const config = buildCoreConfig(record, proxyPort);
    const directory = await mkdtemp(path.join(tmpdir(), 'tsub-speedtest-'));
    const configPath = path.join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });

    let stderr = '';
    const child = spawn(corePath, ['run', '-c', configPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
    });
    child.stderr?.on('data', chunk => {
        if (stderr.length < 4096) stderr += chunk.toString();
    });

    let exited = false;
    let exitError = null;
    child.once('exit', code => {
        exited = true;
        exitError = new Error(`speedtest_core_exited_${code}`);
    });
    child.once('error', error => {
        exited = true;
        exitError = error;
    });

    const deadline = Date.now() + timeoutMs;
    try {
        for (;;) {
            if (exited) throw exitError || new Error('speedtest_core_exited');
            if (remaining(deadline) <= 0) throw new Error('speedtest_core_start_timeout');
            try {
                await connectOnce('127.0.0.1', proxyPort, Math.min(250, remaining(deadline)));
                break;
            } catch {
                await delay(50);
            }
        }
    } catch (error) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        await rm(directory, { recursive: true, force: true }).catch(() => {});
        const detail = stderr.trim().split(/\r?\n/).slice(-1)[0];
        throw new Error(detail ? `${error.message}: ${detail}` : error.message);
    }

    let closed = false;
    const close = async () => {
        if (closed) return;
        closed = true;
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        if (!exited) {
            await Promise.race([
                new Promise(resolve => child.once('exit', resolve)),
                delay(1000)
            ]);
        }
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        await rm(directory, { recursive: true, force: true }).catch(() => {});
    };

    return {
        async ping(url, pingTimeout) {
            const result = await requestThroughSocks(proxyPort, url, Math.max(1, pingTimeout), { stopAtFirstByte: true });
            return result.latency;
        },
        async download(url, downloadTimeout) {
            const target = new URL(url);
            return requestThroughSocks(proxyPort, url, Math.max(1, downloadTimeout), {
                maxBytes: downloadLimit(target)
            });
        },
        close
    };
}

export function createSpeedTestRunner(options = {}) {
    const corePath = options.corePath || process.env.TSUB_SPEEDTEST_CORE || 'sing-box';
    return {
        open(record, openOptions = {}) {
            return openSession(record, openOptions, corePath);
        }
    };
}
