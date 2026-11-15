import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCache = vi.fn();
const triggerBackgroundRefresh = vi.fn();

vi.mock('../../functions/services/node-cache-service.js', () => ({
  getCache: (...args) => getCache(...args),
  triggerBackgroundRefresh: (...args) => triggerBackgroundRefresh(...args),
  createCacheHeaders: (status, nodeCount) => ({
    'X-Cache-Status': status,
    'X-Node-Count': String(nodeCount)
  })
}));

import {
  REFRESH_DEBOUNCE_MAX_ENTRIES,
  REFRESH_DEBOUNCE_TTL,
  clearRefreshDebounce,
  getRefreshDebounceSize,
  pruneRefreshDebounce,
  resolveNodeListWithCache
} from '../../functions/modules/subscription/cache-manager.js';

const staleCache = {
  data: {
    nodes: 'trojan://password@1.2.3.4:443#HK-01',
    timestamp: Date.now() - 60_000,
    nodeCount: 1,
    sources: ['airport']
  },
  status: 'stale'
};

async function resolveFor(cacheKey) {
  return resolveNodeListWithCache({
    storageAdapter: {},
    cacheKey,
    forceRefresh: false,
    refreshNodes: vi.fn().mockResolvedValue(''),
    context: {},
    targetTsubsCount: 1
  });
}

describe('refresh debounce memory bounds', () => {
  beforeEach(() => {
    clearRefreshDebounce();
    vi.clearAllMocks();
    getCache.mockResolvedValue(staleCache);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the debounce map at or below the configured cap', async () => {
    for (let index = 0; index < REFRESH_DEBOUNCE_MAX_ENTRIES + 250; index += 1) {
      await resolveFor(`cache-key-${index}`);
    }

    expect(getRefreshDebounceSize()).toBeLessThanOrEqual(REFRESH_DEBOUNCE_MAX_ENTRIES);
    expect(getRefreshDebounceSize()).toBe(REFRESH_DEBOUNCE_MAX_ENTRIES);
    expect(triggerBackgroundRefresh).toHaveBeenCalledTimes(REFRESH_DEBOUNCE_MAX_ENTRIES + 250);
  });

  it('still debounces refreshes for the same cache key', async () => {
    await resolveFor('same-key');
    await resolveFor('same-key');
    await resolveFor('same-key');

    expect(triggerBackgroundRefresh).toHaveBeenCalledTimes(1);
    expect(getRefreshDebounceSize()).toBe(1);
  });

  it('drops entries older than the TTL', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(start);

    await resolveFor('old-key');
    expect(getRefreshDebounceSize()).toBe(1);

    vi.setSystemTime(new Date(start.getTime() + REFRESH_DEBOUNCE_TTL + 1));
    pruneRefreshDebounce();

    expect(getRefreshDebounceSize()).toBe(0);
  });
});
