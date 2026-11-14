/**
 * Layered node speed-test operator.
 *
 * The layers intentionally mirror v2rayN:
 *   1. TCP ping  -> network reachability of server:port.
 *   2. Real ping -> HTTP request through the complete proxy chain.
 *   3. Speed test -> download through the same proxy chain, only after a
 *      successful real ping.
 *
 * This module never removes nodes and never changes their names. It only
 * writes `metadata.latency` (ms, -1 on failure) and `metadata.speed` (KB/s).
 */

export const DEFAULT_SPEED_TEST_PARAMS = Object.freeze({
    testMode: 'real',
    pingUrl: 'http://cp.cloudflare.com/generate_204',
    enableSpeedTest: false,
    speedTestUrl: 'https://speed.cloudflare.com/__down?bytes=10000000',
    timeout: 8000,
    concurrency: 8
});

const MAX_TIMEOUT = 120_000;
const MAX_CONCURRENCY = 32;

function clampInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeUrl(value, fallback) {
    const candidate = typeof value === 'string' ? value.trim() : '';
    if (!candidate) return fallback;
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : fallback;
    } catch {
        return fallback;
    }
}

export function normalizeSpeedTestParams(params = {}) {
    const source = params && typeof params === 'object' ? params : {};
    return {
        testMode: source.testMode === 'tcp' ? 'tcp' : 'real',
        pingUrl: normalizeUrl(source.pingUrl, DEFAULT_SPEED_TEST_PARAMS.pingUrl),
        enableSpeedTest: source.enableSpeedTest === true,
        speedTestUrl: normalizeUrl(source.speedTestUrl, DEFAULT_SPEED_TEST_PARAMS.speedTestUrl),
        timeout: clampInteger(source.timeout, DEFAULT_SPEED_TEST_PARAMS.timeout, 1, MAX_TIMEOUT),
        concurrency: clampInteger(source.concurrency, DEFAULT_SPEED_TEST_PARAMS.concurrency, 1, MAX_CONCURRENCY)
    };
}

function remainingTime(deadline) {
    return Math.max(0, deadline - Date.now());
}

function toFiniteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function roundSpeed(value) {
    return Math.round(value * 10) / 10;
}

/* -------------------------------------------------------------------------- */
/* TCP layer                                                                  */
/* -------------------------------------------------------------------------- */

let tcpConnectorPromise = null;

function createNodeTcpConnector(net) {
    return (host, port, timeoutMs) => new Promise((resolve, reject) => {
        const started = Date.now();
        let settled = false;
        const socket = net.connect({ host, port });

        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.removeAllListeners();
            socket.destroy();
            if (error) reject(error);
            else resolve(Date.now() - started);
        };

        const timer = setTimeout(() => finish(new Error('tcp_timeout')), timeoutMs);
        socket.once('connect', () => finish());
        socket.once('error', (error) => finish(error));
    });
}

function createWorkerTcpConnector(sockets) {
    return async (host, port, timeoutMs) => {
        const started = Date.now();
        const socket = sockets.connect({ hostname: host, port });
        let timer;
        try {
            await Promise.race([
                socket.opened,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('tcp_timeout')), timeoutMs);
                })
            ]);
            return Date.now() - started;
        } finally {
            clearTimeout(timer);
            try { socket.close(); } catch { /* already closed */ }
        }
    };
}

/**
 * Resolve a TCP connector for the current runtime.
 *
 * - Self-hosted Node controller: `node:net`.
 * - Cloudflare Workers / Pages: `cloudflare:sockets` when the runtime exposes it.
 * - Anything else: TCP mode is reported as unavailable instead of throwing.
 */
async function resolveTcpConnector() {
    if (!tcpConnectorPromise) {
        tcpConnectorPromise = (async () => {
            const nodeNetSpecifier = ['node', 'net'].join(':');
            try {
                const net = await import(nodeNetSpecifier);
                if (typeof net?.connect === 'function') return createNodeTcpConnector(net);
            } catch { /* not a Node runtime */ }

            const socketSpecifier = ['cloudflare', 'sockets'].join(':');
            try {
                const sockets = await import(socketSpecifier);
                if (typeof sockets?.connect === 'function') return createWorkerTcpConnector(sockets);
            } catch { /* sockets module unavailable */ }

            return null;
        })();
    }
    return tcpConnectorPromise;
}

async function runTcpPing(record, options, context, deadline) {
    const host = String(record?.server || '').trim();
    const port = Number.parseInt(record?.port, 10);
    if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
        return { latency: -1, error: 'invalid_server' };
    }

    const timeoutMs = remainingTime(deadline);
    if (timeoutMs <= 0) return { latency: -1, error: 'timeout' };

    try {
        const connector = typeof context?.tcpConnect === 'function'
            ? context.tcpConnect
            : await resolveTcpConnector();
        if (!connector) return { latency: -1, error: 'tcp_unavailable' };

        const latency = await connector(host, port, timeoutMs);
        return { latency: Number.isFinite(latency) && latency >= 0 ? latency : -1, error: '' };
    } catch (error) {
        return { latency: -1, error: error?.message || 'tcp_failed' };
    }
}

/* -------------------------------------------------------------------------- */
/* Real ping / speed layer                                                    */
/* -------------------------------------------------------------------------- */

function resolveRunner(context) {
    const candidate = context?.speedTestRunner || context?.env?.TSUB_SPEEDTEST_RUNNER;
    return candidate && typeof candidate.open === 'function' ? candidate : null;
}

async function runRealPing(record, options, runner, deadline) {
    if (!runner) {
        return { latency: -1, error: 'real_test_unavailable', session: null };
    }

    let session = null;
    try {
        const openTimeout = remainingTime(deadline);
        if (openTimeout <= 0) return { latency: -1, error: 'timeout', session: null };

        session = await runner.open(record, {
            timeout: openTimeout,
            pingUrl: options.pingUrl
        });

        let latency = -1;
        let lastError = '';

        // v2rayN sends the real ping twice and keeps the smaller value.
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const timeoutMs = remainingTime(deadline);
            if (timeoutMs <= 0) {
                lastError = lastError || 'timeout';
                break;
            }
            try {
                const value = await session.ping(options.pingUrl, timeoutMs);
                const numeric = toFiniteNumber(value);
                if (numeric !== null && numeric >= 0) {
                    latency = latency < 0 ? numeric : Math.min(latency, numeric);
                } else {
                    lastError = 'real_ping_failed';
                }
            } catch (error) {
                lastError = error?.message || 'real_ping_failed';
            }
        }

        return { latency, error: latency >= 0 ? '' : (lastError || 'real_ping_failed'), session };
    } catch (error) {
        if (session?.close) {
            try { await session.close(); } catch { /* ignore cleanup errors */ }
        }
        return { latency: -1, error: error?.message || 'real_test_failed', session: null };
    }
}

async function runDownloadSpeed(record, options, session, deadline) {
    if (!session || typeof session.download !== 'function') {
        return { speed: 0, error: 'download_unavailable' };
    }

    const timeoutMs = remainingTime(deadline);
    if (timeoutMs <= 0) return { speed: 0, error: 'timeout' };

    try {
        const result = await session.download(options.speedTestUrl, timeoutMs);
        const bytes = toFiniteNumber(result?.bytes) || 0;
        const elapsedMs = Math.max(1, toFiniteNumber(result?.elapsedMs) || 1);
        if (bytes <= 0) return { speed: 0, error: result?.error || 'empty_download' };
        return {
            speed: roundSpeed((bytes / (elapsedMs / 1000)) / 1024),
            error: ''
        };
    } catch (error) {
        return { speed: 0, error: error?.message || 'download_failed' };
    }
}

/* -------------------------------------------------------------------------- */
/* Per-node test                                                              */
/* -------------------------------------------------------------------------- */

async function testNode(record, options, context) {
    const startedAt = Date.now();
    const deadline = startedAt + options.timeout;
    const metadata = { ...(record?.metadata || {}) };

    let latency = -1;
    let speed = 0;
    let latencyError = '';
    let speedError = '';
    let session = null;

    try {
        if (options.testMode === 'tcp') {
            const tcp = await runTcpPing(record, options, context, deadline);
            latency = tcp.latency;
            latencyError = tcp.error;
            // A TCP-only test has no proxy chain, so a download would bypass
            // the node. Keep the layering strict and do not run it.
            if (options.enableSpeedTest && latency >= 0) {
                speedError = 'speed_test_requires_real_mode';
            }
        } else {
            const runner = resolveRunner(context);
            const real = await runRealPing(record, options, runner, deadline);
            latency = real.latency;
            latencyError = real.error;
            session = real.session;

            if (options.enableSpeedTest && latency >= 0) {
                const download = await runDownloadSpeed(record, options, session, deadline);
                speed = download.speed;
                speedError = download.error;
            }
        }
    } catch (error) {
        latency = -1;
        speed = 0;
        latencyError = error?.message || 'speed_test_failed';
    } finally {
        if (session?.close) {
            try { await session.close(); } catch { /* ignore cleanup errors */ }
        }
    }

    metadata.latency = latency;
    metadata.speed = speed;
    metadata.speedTestMode = options.testMode;
    metadata.speedTestAt = new Date(startedAt).toISOString();
    metadata.speedTestElapsedMs = Date.now() - startedAt;
    if (latency < 0) metadata.latencyError = latencyError || 'unknown_error';
    else delete metadata.latencyError;
    if (speedError) metadata.speedError = speedError;
    else delete metadata.speedError;

    return { ...record, metadata };
}

/**
 * Run the layered speed-test operator over records.
 *
 * @param {Array<Object>} records
 * @param {Object} params
 * @param {Object} context - may provide `speedTestRunner`, `tcpConnect`, `env`.
 * @returns {Promise<Array<Object>>}
 */
export async function runSpeedTestOperator(records, params = {}, context = {}) {
    if (!Array.isArray(records) || records.length === 0) return records || [];

    const options = normalizeSpeedTestParams(params);
    const results = new Array(records.length);
    let cursor = 0;

    const worker = async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= records.length) return;
            try {
                results[index] = await testNode(records[index], options, context);
            } catch (error) {
                // Defensive isolation: a bug in one node's test must never
                // abort the whole operator chain or the other workers.
                const record = records[index] || {};
                results[index] = {
                    ...record,
                    metadata: {
                        ...(record.metadata || {}),
                        latency: -1,
                        speed: 0,
                        speedTestMode: options.testMode,
                        speedTestAt: new Date().toISOString(),
                        latencyError: error?.message || 'speed_test_failed'
                    }
                };
            }
        }
    };

    const workerCount = Math.min(options.concurrency, records.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results;
}
