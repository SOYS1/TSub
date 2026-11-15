/**
 * Speed-test result cache.
 *
 * A full TCP sweep on every subscription refresh is what triggered Cloudflare's
 * port-scan protection in the past. This module persists the outcome of each
 * measurement (`latency`, `speed`, `speedTestAt`) under
 * `speedtest_cache_{server}:{port}` in the active storage adapter (KV or D1)
 * and keeps a small in-isolate memory layer so repeated refreshes can reuse
 * results without touching storage.
 *
 * The storage layer is intentionally best-effort: any failure degrades to
 * "cache miss" and the caller falls back to real testing instead of throwing.
 */

import { StorageFactory } from '../storage-adapter.js';

export const SPEED_TEST_CACHE_PREFIX = 'speedtest_cache_';
export const DEFAULT_CACHE_TTL_MINUTES = 30;
export const MAX_CACHE_TTL_MINUTES = 24 * 60;

// Failures are cached for a shorter window: a dead node may come back, and a
// 30 minute -1 lockout would hide healthy nodes after a transient network blip.
const FAILED_ENTRY_TTL_MS = 5 * 60 * 1000;

// Bounded in-isolate cache. Cloudflare reuses isolates between requests, so
// this absorbs most repeated refreshes without extra KV read/write operations.
const MEMORY_CACHE_LIMIT = 1000;

// Keep KV fan-out modest: a 100 node list must not open 100 concurrent reads.
const READ_CONCURRENCY = 10;
const WRITE_CONCURRENCY = 2;

// Smooth KV write bursts. This is not a hard control: once the budget is
// exhausted the entries stay in the in-isolate layer and are persisted on a
// later run instead of hammering KV (and the associated write billing).
const WRITE_BUDGET_PER_MINUTE = 30;
let writeWindowStartedAt = 0;
let writeWindowCount = 0;

function consumeWriteBudget(size) {
    const now = Date.now();
    if (now - writeWindowStartedAt >= 60 * 1000) {
        writeWindowStartedAt = now;
        writeWindowCount = 0;
    }
    if (writeWindowCount + size > WRITE_BUDGET_PER_MINUTE) return false;
    writeWindowCount += size;
    return true;
}

/** key -> { entry, expiresAt } */
const memoryCache = new Map();
/** env object -> Promise<adapter|null> */
const adapterPromises = new WeakMap();

function toFiniteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function safeParse(raw) {
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Normalize `server` / `port` into a stable cache key.
 * IPv6 brackets and host casing are normalized so the same endpoint always
 * maps to the same entry.
 */
export function buildSpeedTestCacheKey(record) {
    const rawHost = String(record?.server || '').trim().toLowerCase();
    if (!rawHost) return '';
    const host = rawHost.startsWith('[') && rawHost.endsWith(']')
        ? rawHost.slice(1, -1)
        : rawHost;
    const port = Number.parseInt(record?.port, 10);
    if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return '';
    return `${SPEED_TEST_CACHE_PREFIX}${host}:${port}`;
}

/** Convert the configured TTL (minutes) into milliseconds. 0 disables the cache. */
export function resolveSpeedTestCacheTtlMs(minutes) {
    const numeric = Number(minutes);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.min(numeric, MAX_CACHE_TTL_MINUTES) * 60 * 1000;
}

/** Validate and normalize a cache entry read from storage or memory. */
export function normalizeSpeedTestCacheEntry(raw) {
    const source = safeParse(raw);
    if (!source || typeof source !== 'object') return null;

    const latency = toFiniteNumber(source.latency);
    const speed = toFiniteNumber(source.speed);
    const testedAt = Date.parse(source.speedTestAt);
    if (latency === null || !Number.isFinite(testedAt)) return null;

    return {
        latency: latency < 0 ? -1 : Math.round(latency),
        speed: speed !== null && speed >= 0 ? speed : 0,
        speedTestAt: new Date(testedAt).toISOString(),
        speedTestMode: source.speedTestMode === 'tcp' ? 'tcp' : 'real',
        latencyError: typeof source.latencyError === 'string' ? source.latencyError : '',
        speedError: typeof source.speedError === 'string' ? source.speedError : ''
    };
}

function entryLifetimeMs(entry, ttlMs) {
    if (ttlMs <= 0) return 0;
    const lifetime = entry.latency < 0 ? Math.min(ttlMs, FAILED_ENTRY_TTL_MS) : ttlMs;
    return Math.max(0, lifetime);
}

export function isSpeedTestCacheEntryFresh(entry, ttlMs, now = Date.now()) {
    if (!entry || ttlMs <= 0) return false;
    const testedAt = Date.parse(entry.speedTestAt);
    if (!Number.isFinite(testedAt)) return false;
    const age = now - testedAt;
    return age >= 0 && age <= entryLifetimeMs(entry, ttlMs);
}

function readMemoryEntry(key) {
    const hit = memoryCache.get(key);
    if (!hit) return null;
    // Refresh insertion order so the limit evicts the least recently used key.
    memoryCache.delete(key);
    memoryCache.set(key, hit);
    return hit.entry;
}

function writeMemoryEntry(key, entry) {
    if (!key || !entry) return;
    memoryCache.delete(key);
    memoryCache.set(key, { entry });
    while (memoryCache.size > MEMORY_CACHE_LIMIT) {
        const oldest = memoryCache.keys().next().value;
        if (oldest === undefined) break;
        memoryCache.delete(oldest);
    }
}

/** Test hook: drop the in-isolate layer between test cases. */
export function clearSpeedTestMemoryCache() {
    memoryCache.clear();
}

function isStorageAdapter(value) {
    return Boolean(value)
        && typeof value.get === 'function'
        && typeof value.put === 'function';
}

/**
 * Resolve the storage adapter used for the speed-test cache.
 *
 * Preference order:
 *   1. an explicitly provided adapter on the operator context;
 *   2. the request-scoped adapter (`context.storage`, set by the main handler);
 *   3. the active adapter resolved from `env` (memoized per env object).
 */
export async function resolveSpeedTestCacheAdapter(context = {}) {
    if (!context || context.speedTestCache === false) return null;

    for (const candidate of [context.speedTestCacheAdapter, context.storageAdapter, context.storage]) {
        if (isStorageAdapter(candidate)) return candidate;
    }

    const env = context.env;
    if (!env || typeof env !== 'object') return null;

    if (!adapterPromises.has(env)) {
        adapterPromises.set(env, (async () => {
            try {
                return await StorageFactory.getActiveAdapter(env);
            } catch (error) {
                console.warn('[SpeedTestCache] Storage adapter unavailable:', error?.message || error);
                return null;
            }
        })());
    }
    return adapterPromises.get(env);
}

async function runWithConcurrency(items, limit, worker) {
    if (!Array.isArray(items) || items.length === 0) return;
    const workers = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;
    await Promise.all(Array.from({ length: workers }, async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            await worker(items[index], index);
        }
    }));
}

/**
 * Read cached measurements for the given records.
 *
 * @returns {Promise<Map<string, {entry: Object, fresh: boolean}>>}
 *   Only keys with a usable entry are present; `fresh` distinguishes a TTL hit
 *   from a stale value that may still be used when this run cannot test.
 */
export async function readSpeedTestCache(records, context = {}, options = {}) {
    const result = new Map();
    const configuredTtl = options.cacheTtlMinutes;
    const ttlMinutes = configuredTtl === undefined || configuredTtl === null || configuredTtl === ''
        ? DEFAULT_CACHE_TTL_MINUTES
        : configuredTtl;
    const ttlMs = resolveSpeedTestCacheTtlMs(ttlMinutes);
    if (ttlMs <= 0 || !Array.isArray(records) || records.length === 0) return result;

    const keys = [];
    const seen = new Set();
    for (const record of records) {
        const key = buildSpeedTestCacheKey(record);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
    }
    if (keys.length === 0) return result;

    const now = Date.now();
    const missing = [];
    for (const key of keys) {
        const memoryEntry = readMemoryEntry(key);
        if (memoryEntry) {
            result.set(key, { entry: memoryEntry, fresh: isSpeedTestCacheEntryFresh(memoryEntry, ttlMs, now) });
        } else {
            missing.push(key);
        }
    }

    if (missing.length === 0) return result;

    const adapter = await resolveSpeedTestCacheAdapter(context);
    if (!adapter) return result;

    await runWithConcurrency(missing, READ_CONCURRENCY, async key => {
        let entry = null;
        try {
            entry = normalizeSpeedTestCacheEntry(await adapter.get(key));
        } catch (error) {
            console.warn('[SpeedTestCache] Failed to read', key, error?.message || error);
        }
        if (!entry) return;
        writeMemoryEntry(key, entry);
        result.set(key, { entry, fresh: isSpeedTestCacheEntryFresh(entry, ttlMs, now) });
    });

    return result;
}

/**
 * Merge a cached measurement into a node record.
 *
 * A record that already carries a newer measurement (for example from an
 * upstream speed-test operator earlier in the same chain) is left untouched.
 */
export function applySpeedTestCacheEntry(record, entry, now = Date.now()) {
    const normalized = normalizeSpeedTestCacheEntry(entry);
    if (!normalized) return record;

    const metadata = { ...(record?.metadata || {}) };
    const existingLatency = toFiniteNumber(metadata.latency);
    const existingAt = Date.parse(metadata.speedTestAt);
    const cacheAt = Date.parse(normalized.speedTestAt);

    if (existingLatency !== null && existingLatency >= 0
        && Number.isFinite(existingAt) && Number.isFinite(cacheAt) && existingAt > cacheAt) {
        return record;
    }

    metadata.latency = normalized.latency;
    metadata.speed = normalized.speed;
    metadata.speedTestMode = normalized.speedTestMode;
    metadata.speedTestAt = normalized.speedTestAt;
    metadata.speedTestElapsedMs = 0;
    metadata.speedTestCached = true;
    metadata.speedTestAgeMs = Math.max(0, now - cacheAt);
    delete metadata.speedTestPending;
    delete metadata.speedTestDeferredReason;
    delete metadata.speedTestStale;

    if (normalized.latency < 0) {
        metadata.latencyError = normalized.latencyError || 'cached_failure';
    } else {
        delete metadata.latencyError;
    }
    if (normalized.speedError) metadata.speedError = normalized.speedError;
    else delete metadata.speedError;

    return { ...record, metadata };
}

/** Build a persistable entry from the metadata written by the speed-test operator. */
export function buildSpeedTestCacheEntry(metadata) {
    const latency = toFiniteNumber(metadata?.latency);
    if (latency === null) return null;
    return normalizeSpeedTestCacheEntry({
        latency: latency < 0 ? -1 : Math.round(latency),
        speed: toFiniteNumber(metadata?.speed) ?? 0,
        speedTestAt: metadata?.speedTestAt,
        speedTestMode: metadata?.speedTestMode,
        latencyError: metadata?.latencyError,
        speedError: metadata?.speedError
    });
}

/**
 * Collect cache entries for nodes measured in this run.
 *
 * @param {Array<{record: Object, metadata: Object}>} tested
 * @returns {Map<string, Object>} deduplicated by cache key, newest wins.
 */
export function collectSpeedTestCacheEntries(tested) {
    const entries = new Map();
    for (const item of tested || []) {
        const key = buildSpeedTestCacheKey(item?.record);
        if (!key) continue;
        const entry = buildSpeedTestCacheEntry(item.metadata);
        if (!entry) continue;
        const existing = entries.get(key);
        if (!existing || Date.parse(entry.speedTestAt) >= Date.parse(existing.speedTestAt)) {
            entries.set(key, entry);
        }
    }
    return entries;
}

/**
 * Persist collected entries.
 *
 * Writes go through the in-isolate layer immediately and then to storage with
 * low concurrency. The returned promise never rejects.
 */
export async function writeSpeedTestCacheEntries(entries, context = {}) {
    if (!entries || entries.size === 0) return false;

    const adapter = await resolveSpeedTestCacheAdapter(context);
    if (!adapter) return false;

    // Only populate the in-isolate layer once we know a persistent adapter is
    // configured, so the memory cache can never outlive the storage layer.
    for (const [key, entry] of entries) writeMemoryEntry(key, entry);

    const items = Array.from(entries.entries());
    if (!consumeWriteBudget(items.length)) {
        console.warn('[SpeedTestCache] Write budget reached, deferring', items.length, 'entries');
        return false;
    }

    await runWithConcurrency(items, WRITE_CONCURRENCY, async ([key, entry]) => {
        try {
            await adapter.put(key, entry);
        } catch (error) {
            console.warn('[SpeedTestCache] Failed to write', key, error?.message || error);
        }
    });
    return true;
}

/**
 * Schedule a cache write without blocking the response when the runtime
 * supports `waitUntil`. Without it (or in tests) the promise is returned so the
 * caller can await it before the response closes.
 */
export function dispatchSpeedTestCacheWrite(entries, context = {}) {
    if (!entries || entries.size === 0) return null;

    const promise = writeSpeedTestCacheEntries(entries, context);
    if (typeof context?.waitUntil === 'function') {
        context.waitUntil(promise);
        return null;
    }
    return promise;
}

/**
 * Hydrate records with cached measurements. Used by the Filter operator so
 * `maxLatency` / `minSpeed` also see results measured on a previous request.
 */
export async function hydrateRecordsFromSpeedTestCache(records, context = {}, options = {}) {
    if (!Array.isArray(records) || records.length === 0) return records || [];
    const cache = await readSpeedTestCache(records, context, options);
    if (cache.size === 0) return records;

    return records.map(record => {
        const key = buildSpeedTestCacheKey(record);
        const hit = key ? cache.get(key) : null;
        if (!hit?.entry) return record;
        const applied = applySpeedTestCacheEntry(record, hit.entry);
        if (hit.fresh) return applied;
        // Stale data is still better than dropping a node whose batch has not
        // run yet, but make the state visible for debugging.
        return {
            ...applied,
            metadata: { ...(applied?.metadata || {}), speedTestStale: true }
        };
    });
}
