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
 *
 * Every node always leaves this operator with a numeric `metadata.latency`.
 * Cloudflare Workers / Pages can only run layer 1 (`cloudflare:sockets`);
 * layers 2 and 3 need the self-hosted proxy-core runner.
 */

export const DEFAULT_SPEED_TEST_PARAMS = Object.freeze({
    testMode: 'real',
    pingUrl: 'http://cp.cloudflare.com/generate_204',
    enableSpeedTest: false,
    speedTestUrl: 'https://speed.cloudflare.com/__down?bytes=10000000',
    timeout: 8000,
    concurrency: 8
});

export const CLOUDFLARE_REAL_PING_ERROR = 'cloudflare_env_does_not_support_real_ping';

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
/* Runtime detection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Detect the Cloudflare Workers / Pages runtime.
 *
 * `navigator.userAgent` is the official marker; `WebSocketPair` is a workerd
 * global used as a fallback for older compatibility dates.
 */
export function isCloudflareRuntime() {
    try {
        if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') {
            return true;
        }
        // Self-hosted controllers run on Node, which never exposes
        // `WebSocketPair`; bail out before the fallback probe.
        if (typeof process !== 'undefined' && process?.versions?.node) return false;
        return typeof WebSocketPair !== 'undefined';
    } catch {
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/* TCP layer                                                                  */
/* -------------------------------------------------------------------------- */

let tcpConnectorPromise = null;

function createNodeTcpConnector(net) {
    return (host, port, timeoutMs) => new Promise((resolve, reject) => {
        const started = Date.now();
        let settled = false;
        let socket = null;

        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { socket?.removeAllListeners(); } catch { /* ignore */ }
            try { socket?.destroy(); } catch { /* ignore */ }
            if (error) reject(error);
            else resolve(Math.max(0, Date.now() - started));
        };

        const timer = setTimeout(() => finish(new Error('tcp_timeout')), Math.max(1, timeoutMs));
        try {
            socket = net.connect({ host, port });
            socket.once('connect', () => finish());
            socket.once('error', (error) => finish(error));
        } catch (error) {
            finish(error);
        }
    });
}

/**
 * Cloudflare TCP connector.
 *
 * `connect()` starts the handshake; `socket.opened` resolves once the TCP
 * connection is established. No data is written: the handshake alone is the
 * connectivity signal we need. A per-node AbortController closes the socket
 * and rejects with `tcp_timeout` when the deadline is exceeded.
 */
function createWorkerTcpConnector(sockets) {
    return async (host, port, timeoutMs) => {
        const started = Date.now();
        const controller = new AbortController();
        let socket = null;
        let timer = null;

        const timeoutError = new Error('tcp_timeout');
        timeoutError.name = 'AbortError';

        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(timeoutError);
            }, Math.max(1, timeoutMs));
        });

        try {
            socket = sockets.connect(
                { hostname: host, port },
                { secureTransport: 'off', allowHalfOpen: false }
            );

            controller.signal.addEventListener('abort', () => {
                try { socket?.close(); } catch { /* already closed */ }
            }, { once: true });

            await Promise.race([socket.opened, timeoutPromise]);
            return Math.max(0, Date.now() - started);
        } catch (error) {
            if (controller.signal.aborted) throw timeoutError;
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
            try { socket?.close(); } catch { /* already closed */ }
        }
    };
}

/**
 * Resolve a TCP connector for the current runtime.
 *
 * - Cloudflare Workers / Pages: statically-imported `cloudflare:sockets`.
 * - Self-hosted Node controller: `node:net`.
 * - Anything else: null, so `runTcpPing` reports `tcp_unavailable` instead of
 *   throwing.
 */
async function resolveTcpConnector() {
    if (!tcpConnectorPromise) {
        tcpConnectorPromise = (async () => {
            if (isCloudflareRuntime()) {
                try {
                    const sockets = await import('./cloudflare-sockets.js');
                    if (typeof sockets?.connect === 'function') {
                        return createWorkerTcpConnector(sockets);
                    }
                } catch { /* sockets module unavailable */ }
                return null;
            }

            try {
                const net = await import('node:net');
                if (typeof net?.connect === 'function') return createNodeTcpConnector(net);
            } catch { /* not a Node runtime */ }

            // Last resort: some Workers-compatible runtimes only expose the
            // cloudflare:sockets module without advertising themselves.
            try {
                const sockets = await import('./cloudflare-sockets.js');
                if (typeof sockets?.connect === 'function') {
                    return createWorkerTcpConnector(sockets);
                }
            } catch { /* sockets module unavailable */ }

            return null;
        })();
    }
    return tcpConnectorPromise;
}

/**
 * Run a TCP handshake ping. This function never throws and never returns an
 * undefined latency: every failure path resolves to `{ latency: -1, error }`.
 */
async function runTcpPing(record, options, context, deadline) {
    let latency = -1;
    let error = '';

    try {
        const host = String(record?.server || '').trim();
        const port = Number.parseInt(record?.port, 10);

        if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
            return { latency: -1, error: 'invalid_server' };
        }

        const timeoutMs = remainingTime(deadline);
        if (timeoutMs <= 0) {
            return { latency: -1, error: 'timeout' };
        }

        const connector = typeof context?.tcpConnect === 'function'
            ? context.tcpConnect
            : await resolveTcpConnector();

        if (typeof connector !== 'function') {
            return { latency: -1, error: 'tcp_unavailable' };
        }

        const measured = toFiniteNumber(await connector(host, port, timeoutMs));
        if (measured !== null && measured >= 0) {
            latency = Math.round(measured);
        } else {
            error = 'tcp_invalid_latency';
        }
    } catch (caught) {
        latency = -1;
        error = caught?.name === 'AbortError'
            ? 'tcp_timeout'
            : (caught?.message || 'tcp_failed');
    } finally {
        // Ironclad fallback: no code path may leak an undefined / NaN latency.
        if (!Number.isFinite(latency) || latency < 0) {
            latency = -1;
            error = error || 'tcp_failed';
        }
    }

    return { latency, error };
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

/**
 * Normalize a record so its metadata always contains a numeric latency/speed.
 * Used as a final safety net for every result leaving the operator.
 */
function ensureMeasuredResult(record, fallbackRecord, options, testedAt = new Date().toISOString()) {
    const source = record || fallbackRecord || {};
    const metadata = { ...(source.metadata || {}) };

    const latency = toFiniteNumber(metadata.latency);
    const speed = toFiniteNumber(metadata.speed);

    const normalized = {
        ...metadata,
        latency: latency !== null && latency >= 0 ? Math.round(latency) : -1,
        speed: speed !== null && speed >= 0 ? speed : 0,
        speedTestMode: metadata.speedTestMode || options.testMode,
        speedTestAt: metadata.speedTestAt || testedAt,
        speedTestElapsedMs: Number.isFinite(metadata.speedTestElapsedMs)
            ? metadata.speedTestElapsedMs
            : 0
    };

    if (normalized.latency < 0) {
        normalized.latencyError = metadata.latencyError || 'unknown_error';
    } else {
        delete normalized.latencyError;
    }

    return { ...source, metadata: normalized };
}

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

    // Cloudflare Workers / Pages cannot spawn a proxy core. Intercept real
    // ping at the entrance and fail fast instead of burning CPU per node.
    if (options.testMode === 'real' && isCloudflareRuntime() && !resolveRunner(context)) {
        const testedAt = new Date().toISOString();
        return records.map(record => {
            const metadata = {
                ...(record?.metadata || {}),
                latency: -1,
                speed: 0,
                speedTestMode: 'real',
                speedTestAt: testedAt,
                speedTestElapsedMs: 0,
                latencyError: CLOUDFLARE_REAL_PING_ERROR
            };
            if (options.enableSpeedTest) {
                metadata.speedError = CLOUDFLARE_REAL_PING_ERROR;
            } else {
                delete metadata.speedError;
            }
            return { ...record, metadata };
        });
    }

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
                        speedTestElapsedMs: 0,
                        latencyError: error?.message || 'speed_test_failed'
                    }
                };
            }
        }
    };

    const workerCount = Math.min(options.concurrency, records.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    // Final safety net: guarantee every node carries a numeric latency.
    return results.map((record, index) => ensureMeasuredResult(record, records[index], options));
}
