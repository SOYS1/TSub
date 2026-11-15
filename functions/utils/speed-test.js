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
 * Measured nodes leave with a numeric `metadata.latency`. Nodes whose
 * measurement was postponed to a later run (progressive batching) keep their
 * previous metadata and are flagged with `metadata.speedTestPending`.
 * Cloudflare Workers / Pages can only run layer 1 (`cloudflare:sockets`);
 * layers 2 and 3 need the self-hosted proxy-core runner.
 */

import {
    DEFAULT_CACHE_TTL_MINUTES,
    MAX_CACHE_TTL_MINUTES,
    applySpeedTestCacheEntry,
    buildSpeedTestCacheKey,
    collectSpeedTestCacheEntries,
    dispatchSpeedTestCacheWrite,
    readSpeedTestCache
} from './speed-test-cache.js';

export const DEFAULT_SPEED_TEST_PARAMS = Object.freeze({
    testMode: 'real',
    pingUrl: 'http://cp.cloudflare.com/generate_204',
    enableSpeedTest: false,
    speedTestUrl: 'https://speed.cloudflare.com/__down?bytes=10000000',
    timeout: 8000,
    concurrency: 8,
    // Progressive testing + cache. See the comments below for why these are
    // enforced in the Cloudflare runtime.
    cacheTtlMinutes: DEFAULT_CACHE_TTL_MINUTES,
    batchSize: 5,
    maxUncachedPerRun: 20
});

export const CLOUDFLARE_REAL_PING_ERROR = 'cloudflare_env_does_not_support_real_ping';

const MAX_TIMEOUT = 120_000;
const MAX_CONCURRENCY = 32;
const MAX_BATCH_SIZE = 50;
const MAX_UNCACHED_PER_RUN = 500;

// Hard ceilings for the Cloudflare runtime. A subscription refresh must never
// look like a port scan, no matter what the operator config says.
const CLOUDFLARE_MAX_CONCURRENCY = 2;
const CLOUDFLARE_MAX_TIMEOUT = 1500;

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
        concurrency: clampInteger(source.concurrency, DEFAULT_SPEED_TEST_PARAMS.concurrency, 1, MAX_CONCURRENCY),
        cacheTtlMinutes: clampInteger(
            source.cacheTtlMinutes,
            DEFAULT_SPEED_TEST_PARAMS.cacheTtlMinutes,
            1,
            MAX_CACHE_TTL_MINUTES
        ),
        batchSize: clampInteger(source.batchSize, DEFAULT_SPEED_TEST_PARAMS.batchSize, 1, MAX_BATCH_SIZE),
        maxUncachedPerRun: clampInteger(
            source.maxUncachedPerRun,
            DEFAULT_SPEED_TEST_PARAMS.maxUncachedPerRun,
            1,
            MAX_UNCACHED_PER_RUN
        )
    };
}

function hasExplicitParam(params, key) {
    if (!params || typeof params !== 'object' || !Object.prototype.hasOwnProperty.call(params, key)) return false;
    const value = params[key];
    return value !== undefined && value !== null && value !== '';
}

/**
 * Resolve the runtime limits for one operator execution.
 *
 * Cloudflare always enforces concurrency <= 2, timeout <= 1500ms and the
 * progressive batch/safety caps. Self-hosted controllers keep their full
 * concurrency unless the operator explicitly opts into batching.
 *
 * `maxUncachedPerRun` caps the number of nodes a *single run* may test
 * (`plannedCount`), not the size of the whole uncached backlog: with the
 * default batch of 5 a 100-node list is measured progressively instead of
 * being abandoned forever.
 */
function resolveEffectiveLimits(options, params, cloudflare) {
    const progressive = Boolean(cloudflare)
        || hasExplicitParam(params, 'batchSize')
        || hasExplicitParam(params, 'maxUncachedPerRun');

    return {
        cloudflare: Boolean(cloudflare),
        timeout: cloudflare ? Math.min(options.timeout, CLOUDFLARE_MAX_TIMEOUT) : options.timeout,
        concurrency: cloudflare ? Math.min(options.concurrency, CLOUDFLARE_MAX_CONCURRENCY) : options.concurrency,
        batchSize: progressive ? options.batchSize : null,
        maxUncachedPerRun: progressive ? options.maxUncachedPerRun : null
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
 * Mark a record whose measurement was postponed to a later run.
 *
 * Previous measurements are preserved (never overwritten with -1) so a node
 * that is simply waiting for its batch does not get filtered out by accident.
 */
function markDeferredResult(record, reason) {
    return {
        ...record,
        metadata: {
            ...(record?.metadata || {}),
            speedTestPending: true,
            speedTestDeferredReason: reason
        }
    };
}

function applyStaleCacheEntry(record, entry) {
    const applied = applySpeedTestCacheEntry(record, entry);
    const metadata = {
        ...(applied?.metadata || record?.metadata || {}),
        speedTestCached: true,
        speedTestStale: true
    };
    delete metadata.speedTestPending;
    delete metadata.speedTestDeferredReason;
    return { ...applied, metadata };
}

/** Existing Cloudflare behaviour: real ping is impossible, report it fast. */
function markUnavailableResult(record, options, testedAt) {
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
    delete metadata.speedTestPending;
    delete metadata.speedTestDeferredReason;
    return { ...record, metadata };
}

/**
 * Test a bounded list of nodes and write the measured records into `results`.
 * `tested` collects the metadata that must be persisted to the cache.
 */
async function runTestBatch(items, results, tested, options, context) {
    let cursor = 0;

    const worker = async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;

            const { index: resultIndex, record } = items[index];
            try {
                const measured = await testNode(record, options, context);
                results[resultIndex] = measured;
                tested.push({ record: measured, metadata: measured.metadata });
            } catch (error) {
                // Defensive isolation: a bug in one node's test must never
                // abort the whole operator chain or the other workers.
                const metadata = {
                    ...(record?.metadata || {}),
                    latency: -1,
                    speed: 0,
                    speedTestMode: options.testMode,
                    speedTestAt: new Date().toISOString(),
                    speedTestElapsedMs: 0,
                    latencyError: error?.message || 'speed_test_failed'
                };
                results[resultIndex] = { ...record, metadata };
                tested.push({ record, metadata });
            }
        }
    };

    const workerCount = Math.max(1, Math.min(options.concurrency, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

/**
 * Run the layered speed-test operator over records.
 *
 * Cached measurements (default TTL 30 minutes) skip real testing entirely.
 * Uncached nodes are tested in bounded batches, and Cloudflare runs are forced
 * to concurrency 2 / 1500ms with a hard 20-node safety valve.
 *
 * @param {Array<Object>} records
 * @param {Object} params
 * @param {Object} context - may provide `speedTestRunner`, `tcpConnect`, `env`,
 *   `storage` / `storageAdapter`, `waitUntil`.
 * @returns {Promise<Array<Object>>}
 */
export async function runSpeedTestOperator(records, params = {}, context = {}) {
    if (!Array.isArray(records) || records.length === 0) return records || [];

    const options = normalizeSpeedTestParams(params);
    const cloudflare = isCloudflareRuntime();
    const limits = resolveEffectiveLimits(options, params, cloudflare);
    const effectiveOptions = {
        ...options,
        timeout: limits.timeout,
        concurrency: limits.concurrency
    };

    // Cache lookups are read-only and never open sockets. They are safe even
    // for the fast-fail path below.
    const cache = options.cacheTtlMinutes > 0
        ? await readSpeedTestCache(records, context, options)
        : new Map();

    // Cloudflare Workers / Pages cannot spawn a proxy core. Serve cached
    // results, then fail fast instead of burning CPU per node.
    if (effectiveOptions.testMode === 'real' && cloudflare && !resolveRunner(context)) {
        const testedAt = new Date().toISOString();
        return records.map(record => {
            const hit = cache.get(buildSpeedTestCacheKey(record));
            if (hit?.entry) return applySpeedTestCacheEntry(record, hit.entry);
            return markUnavailableResult(record, effectiveOptions, testedAt);
        });
    }

    const results = new Array(records.length);
    const pending = [];

    records.forEach((record, index) => {
        const key = buildSpeedTestCacheKey(record);
        const hit = key ? cache.get(key) : null;
        if (hit?.entry && hit.fresh) {
            results[index] = applySpeedTestCacheEntry(record, hit.entry);
            return;
        }
        pending.push({ index, record, stale: hit?.entry || null });
    });

    const tested = [];

    if (pending.length > 0) {
        // Uncached nodes go first, then the oldest expired entries. Without
        // this ordering a permanently failing node would occupy the batch
        // forever and starve the nodes that were never measured.
        pending.sort((a, b) => {
            const aCached = a.stale ? 1 : 0;
            const bCached = b.stale ? 1 : 0;
            if (aCached !== bCached) return aCached - bCached;
            if (aCached && bCached) {
                return Date.parse(a.stale.speedTestAt) - Date.parse(b.stale.speedTestAt);
            }
            return a.index - b.index;
        });

        const plannedCount = limits.batchSize === null
            ? pending.length
            : Math.min(limits.batchSize, pending.length);

        if (limits.maxUncachedPerRun !== null && plannedCount > limits.maxUncachedPerRun) {
            // Safety valve: a single execution that would open more than
            // `maxUncachedPerRun` sockets (misconfigured batch size, batching
            // disabled) must not become a port scan. Serve stale cache only
            // and never open a socket this run.
            for (const item of pending) {
                results[item.index] = item.stale
                    ? applyStaleCacheEntry(item.record, item.stale)
                    : markDeferredResult(item.record, 'speed_test_safety_threshold');
            }
        } else {
            const selected = limits.batchSize === null
                ? pending
                : pending.slice(0, limits.batchSize);
            const selectedIndexes = new Set(selected.map(item => item.index));

            for (const item of pending) {
                if (selectedIndexes.has(item.index)) continue;
                // Not this round's batch: reuse stale data if we have any,
                // otherwise leave the node untouched for the next refresh.
                results[item.index] = item.stale
                    ? applyStaleCacheEntry(item.record, item.stale)
                    : markDeferredResult(item.record, 'speed_test_batch_deferred');
            }

            await runTestBatch(selected, results, tested, effectiveOptions, context);
        }
    }

    if (tested.length > 0) {
        const entries = collectSpeedTestCacheEntries(tested);
        // KV writes run after the response through `waitUntil`. Without it
        // (tests, self-hosted callers) await them so the data is not lost.
        const writePromise = dispatchSpeedTestCacheWrite(entries, context);
        if (writePromise) await writePromise;
    }

    // Final safety net: guarantee every measured node carries a numeric
    // latency. Deferred nodes keep their original metadata on purpose.
    return results.map((record, index) => {
        const fallback = records[index];
        if (!record) return ensureMeasuredResult(null, fallback, effectiveOptions);
        if (record.metadata?.speedTestPending) return record;
        return ensureMeasuredResult(record, fallback, effectiveOptions);
    });
}
