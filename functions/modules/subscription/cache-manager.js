import {
    getCache,
    triggerBackgroundRefresh,
    createCacheHeaders
} from '../../services/node-cache-service.js';

const refreshDebounce = new Map();
const DEBOUNCE_TIME = 10000;

/**
 * `refreshDebounce` lives for the whole isolate lifetime. Without a bound it
 * grows once per distinct cache key (tokens / profiles), which leaks memory in
 * long-lived Workers. Entries are also stale after a few minutes because the
 * debounce window itself is only 10s.
 */
export const REFRESH_DEBOUNCE_MAX_ENTRIES = 500;
export const REFRESH_DEBOUNCE_TTL = 5 * 60 * 1000;

export function pruneRefreshDebounce(now = Date.now()) {
    for (const [key, timestamp] of refreshDebounce) {
        if (!Number.isFinite(timestamp) || now - timestamp > REFRESH_DEBOUNCE_TTL) {
            refreshDebounce.delete(key);
        }
    }
    while (refreshDebounce.size > REFRESH_DEBOUNCE_MAX_ENTRIES) {
        refreshDebounce.delete(refreshDebounce.keys().next().value);
    }
}

function rememberRefresh(cacheKey, now) {
    // Re-insert so Map iteration order stays least-recently-used first.
    refreshDebounce.delete(cacheKey);
    refreshDebounce.set(cacheKey, now);
    if (refreshDebounce.size > REFRESH_DEBOUNCE_MAX_ENTRIES) {
        pruneRefreshDebounce(now);
    }
}

/** Test / diagnostics helpers. */
export function getRefreshDebounceSize() {
    return refreshDebounce.size;
}

export function clearRefreshDebounce() {
    refreshDebounce.clear();
}

function countCachedNodes(cachedData) {
    const declaredCount = Number(cachedData?.nodeCount);
    if (Number.isFinite(declaredCount)) return declaredCount;
    return String(cachedData?.nodes || '').split('\n').filter(line => line.trim()).length;
}

function hasUsableCachedNodes(cachedData) {
    return Boolean(String(cachedData?.nodes || '').trim()) && countCachedNodes(cachedData) > 0;
}

function populateCachedStats(context, cachedNodeCount, targetTsubsCount) {
    if (!context) return;
    context.generationStats = {
        totalNodes: cachedNodeCount,
        sourceCount: targetTsubsCount,
        successCount: cachedNodeCount,
        failCount: 0,
        duration: 0
    };
}

export async function resolveNodeListWithCache({
    storageAdapter,
    cacheKey,
    forceRefresh,
    refreshNodes,
    context,
    targetTsubsCount
}) {
    const { data: cachedData, status: cacheStatus } = forceRefresh
        ? { data: null, status: 'miss' }
        : await getCache(storageAdapter, cacheKey);

    let combinedNodeList;
    let cacheHeaders = {};
    const canUseCachedData = cachedData && hasUsableCachedNodes(cachedData);

    if (cacheStatus === 'fresh' && canUseCachedData) {
        const cachedNodeCount = countCachedNodes(cachedData);
        combinedNodeList = cachedData.nodes;
        cacheHeaders = createCacheHeaders('HIT', cachedNodeCount);
        populateCachedStats(context, cachedNodeCount, targetTsubsCount);
    } else if ((cacheStatus === 'stale' || cacheStatus === 'expired') && canUseCachedData) {
        const cachedNodeCount = countCachedNodes(cachedData);
        combinedNodeList = cachedData.nodes;
        cacheHeaders = createCacheHeaders('REFRESHING', cachedNodeCount);

        const lastRun = refreshDebounce.get(cacheKey);
        if (!lastRun || Date.now() - lastRun > DEBOUNCE_TIME) {
            rememberRefresh(cacheKey, Date.now());
            triggerBackgroundRefresh(context, () => refreshNodes(true));
        }

        populateCachedStats(context, cachedNodeCount, targetTsubsCount);
    } else {
        combinedNodeList = await refreshNodes(false);
        cacheHeaders = createCacheHeaders('MISS', combinedNodeList.split('\n').filter(line => line.trim()).length);
    }

    return { combinedNodeList, cacheHeaders, cacheStatus };
}
