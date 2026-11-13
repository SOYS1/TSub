import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDirectUrlMode, handleSingleSubscriptionMode } from '../../functions/modules/subscription/single-subscription.js';
import { StorageFactory } from '../../functions/storage-adapter.js';
import { buildSubscriptionNodeCacheKey } from '../../functions/services/subscription-service.js';

describe('single subscription preview cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('writes the saved subscription cache after a successful preview', async () => {
    const subscription = { id: 'preview-cache', name: '魔戒', url: 'https://airport.example/sub', enabled: true, enableNodeCache: true };
    const store = new Map();
    const adapter = {
      getSubscriptionById: vi.fn(async id => id === subscription.id ? subscription : null),
      put: vi.fn(async (key, value) => { store.set(key, value); return true; })
    };
    vi.spyOn(StorageFactory, 'getStorageType').mockResolvedValue('kv');
    vi.spyOn(StorageFactory, 'createAdapter').mockReturnValue(adapter);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('trojan://pass@example.com:443#HK', { status: 200 })));

    const result = await handleSingleSubscriptionMode(new Request('http://local/api/subscription_nodes', { method: 'POST' }), {}, subscription.id, 'TSub-Test');

    expect(result.totalCount).toBe(1);
    expect(store.get(buildSubscriptionNodeCacheKey(subscription))).toMatchObject({
      nodes: ['trojan://pass@example.com:443#HK'], sourceId: subscription.id, sourceName: '魔戒'
    });
  });

  it('does not cache direct URL previews', async () => {
    const createAdapter = vi.spyOn(StorageFactory, 'createAdapter');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('trojan://pass@example.com:443#HK', { status: 200 })));

    const result = await handleDirectUrlMode('https://airport.example/sub', 'TSub-Test');

    expect(result.totalCount).toBe(1);
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it('applies source operators on output without writing renamed URLs to the cache', async () => {
    const subscription = {
      id: 'preview-rename',
      name: '重命名机场',
      url: 'https://airport.example/sub',
      enabled: true,
      enableNodeCache: true,
      operators: [{
        id: 'rename-1',
        type: 'rename',
        enabled: true,
        params: { regex: { enabled: true, rules: [{ pattern: 'HK', replacement: 'Hong Kong' }] } }
      }]
    };
    const store = new Map();
    const adapter = {
      getSubscriptionById: vi.fn(async id => id === subscription.id ? subscription : null),
      get: vi.fn(async () => ({})),
      put: vi.fn(async (key, value) => { store.set(key, value); return true; })
    };
    vi.spyOn(StorageFactory, 'getStorageType').mockResolvedValue('kv');
    vi.spyOn(StorageFactory, 'createAdapter').mockReturnValue(adapter);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('trojan://pass@example.com:443#HK', { status: 200 })));

    const result = await handleSingleSubscriptionMode(new Request('http://local/api/subscription_nodes', { method: 'POST' }), {}, subscription.id, 'TSub-Test');

    expect(result.nodes[0].name).toBe('Hong Kong');
    expect(result.nodes[0].url).toContain('#Hong%20Kong');
    expect(store.get(buildSubscriptionNodeCacheKey(subscription))).toMatchObject({
      nodes: ['trojan://pass@example.com:443#HK']
    });
  });
});
