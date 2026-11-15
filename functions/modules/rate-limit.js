import { StorageFactory } from '../storage-adapter.js';

const memoryEntries = new Map();

/**
 * Memory fallback entries are kept only while they can still affect a request.
 * The TTL never undercuts the caller's own window (which can be a full day for
 * guestbook limits) and the hard entry cap bounds a long-lived isolate even if
 * every window is still active.
 */
export const RATE_LIMIT_MEMORY_MAX_ENTRIES = 1000;
export const RATE_LIMIT_MEMORY_TTL = 5 * 60 * 1000;

function pruneMemoryEntries(now = Date.now()) {
    for (const [key, record] of memoryEntries) {
        if (!record || record.expiresAt <= now) memoryEntries.delete(key);
    }
    while (memoryEntries.size > RATE_LIMIT_MEMORY_MAX_ENTRIES) {
        memoryEntries.delete(memoryEntries.keys().next().value);
    }
}

/** Remove expired entries; safe to call from scheduled maintenance. */
export function pruneRateLimitMemory(now = Date.now()) {
    pruneMemoryEntries(now);
}

/** Test / diagnostics helpers. */
export function getRateLimitMemorySize() {
    return memoryEntries.size;
}

export function hasRateLimitMemoryEntry(key) {
    return memoryEntries.has(key);
}

export function clearRateLimitMemory() {
    memoryEntries.clear();
}

function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function clientIp(request) {
    return String(request?.headers?.get('CF-Connecting-IP') || 'unknown').trim().toLowerCase();
}

async function hashIdentifier(env, scope, identifier) {
    const salt = String(env?.RATE_LIMIT_SECRET || env?.COOKIE_SECRET || env?.DEPLOYMENT_SECRET_KEY || 'tsub-rate-limit-v1');
    const payload = new TextEncoder().encode(`${salt}\0${scope}\0${identifier}`);
    return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)));
}

async function getAdapter(env) {
    try {
        return StorageFactory.createAdapter(env, await StorageFactory.getStorageType(env));
    } catch {
        return null;
    }
}

function normalizeEntry(entry, now, windowMs) {
    if (!entry || Number(entry.windowStartedAt) + windowMs <= now) {
        return { count: 0, windowStartedAt: now, blockedUntil: 0 };
    }
    return {
        count: Math.max(0, Number(entry.count) || 0),
        windowStartedAt: Number(entry.windowStartedAt) || now,
        blockedUntil: Math.max(0, Number(entry.blockedUntil) || 0)
    };
}

async function readEntry(adapter, key) {
    if (adapter) {
        try { return await adapter.get(key); } catch { /* memory fallback */ }
    }
    const record = memoryEntries.get(key);
    if (!record) return null;
    if (!record.expiresAt || record.expiresAt <= Date.now()) {
        memoryEntries.delete(key);
        return null;
    }
    return record.entry || null;
}

async function writeEntry(adapter, key, entry, options = {}) {
    if (adapter) {
        try {
            await adapter.put(key, entry);
            return;
        } catch { /* memory fallback */ }
    }
    const now = Number(options.now) || Date.now();
    const windowMs = Math.max(0, Number(options.windowMs) || 0);
    const blockMs = Math.max(0, Number(options.blockMs) || 0);
    const ttl = Math.max(RATE_LIMIT_MEMORY_TTL, windowMs, blockMs);
    memoryEntries.delete(key);
    memoryEntries.set(key, { entry, expiresAt: now + ttl });
    // Only pay for a sweep once the map is actually over budget; normal writes
    // stay O(1).
    if (memoryEntries.size > RATE_LIMIT_MEMORY_MAX_ENTRIES) {
        pruneMemoryEntries(now);
    }
}

export async function inspectRateLimit(request, env, options) {
    const now = Date.now();
    const identifier = options.identifier || clientIp(request);
    const digest = await hashIdentifier(env, options.scope, identifier);
    const key = `tsub_rate_limit_v1:${options.scope}:${digest}`;
    const adapter = await getAdapter(env);
    const entry = normalizeEntry(await readEntry(adapter, key), now, options.windowMs);
    const blocked = entry.blockedUntil > now;
    return {
        allowed: !blocked && entry.count < options.limit,
        retryAfter: blocked
            ? Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000))
            : Math.max(1, Math.ceil((entry.windowStartedAt + options.windowMs - now) / 1000)),
        key,
        adapter,
        entry,
        now
    };
}

export async function recordRateLimitFailure(state, options) {
    const entry = normalizeEntry(state.entry, state.now, options.windowMs);
    entry.count += 1;
    if (entry.count >= options.limit) entry.blockedUntil = state.now + (options.blockMs || options.windowMs);
    await writeEntry(state.adapter, state.key, entry, {
        now: state.now,
        windowMs: options.windowMs,
        blockMs: options.blockMs
    });
    return entry;
}

export async function consumeRateLimit(request, env, options) {
    const state = await inspectRateLimit(request, env, options);
    if (!state.allowed) return state;
    await recordRateLimitFailure(state, options);
    return { ...state, allowed: true };
}

export async function clearRateLimit(state) {
    if (!state?.key) return;
    if (state.adapter) {
        try {
            await state.adapter.delete(state.key);
            return;
        } catch { /* memory fallback */ }
    }
    memoryEntries.delete(state.key);
}

export function createRateLimitResponse(retryAfter) {
    return new Response(JSON.stringify({ success: false, error: '请求过于频繁，请稍后重试', code: 'RATE_LIMITED' }), {
        status: 429,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Retry-After': String(Math.max(1, retryAfter || 1))
        }
    });
}

export function getRateLimitClientIp(request) {
    return clientIp(request);
}

