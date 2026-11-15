import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUDFLARE_REAL_PING_ERROR,
  DEFAULT_SPEED_TEST_PARAMS,
  isCloudflareRuntime,
  normalizeSpeedTestParams,
  runSpeedTestOperator
} from '../../functions/utils/speed-test.js';
import {
  buildSpeedTestCacheKey,
  clearSpeedTestMemoryCache,
  resolveSpeedTestCacheTtlMs
} from '../../functions/utils/speed-test-cache.js';
import { runOperatorChain } from '../../functions/utils/operator-runner.js';
import { applySubscriptionOperators } from '../../functions/modules/subscription/source-operators.js';
import { generateCombinedNodeList } from '../../functions/services/subscription-service.js';

function node(server, port = 443) {
  return {
    name: `Node ${server}`,
    protocol: 'ss',
    server,
    port,
    url: `ss://YWVzLTEyOC1nY206cGFzcw@${server}:${port}#${encodeURIComponent(`Node ${server}`)}`,
    metadata: {}
  };
}

function runnerFor(handlers) {
  return {
    async open(record, options) {
      return handlers.open(record, options);
    }
  };
}

function memoryAdapter(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
      return true;
    }
  };
}

function cacheEntry(latency, overrides = {}) {
  return {
    latency,
    speed: 0,
    speedTestAt: new Date(Date.now() - 60_000).toISOString(),
    speedTestMode: 'tcp',
    ...overrides
  };
}

describe('speed test operator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses layered real ping then download and keeps the minimum latency', async () => {
    const calls = { open: 0, ping: 0, download: 0, close: 0 };
    const runner = runnerFor({
      open: async () => {
        calls.open += 1;
        return {
          async ping() {
            calls.ping += 1;
            return calls.ping === 1 ? 50 : 30;
          },
          async download() {
            calls.download += 1;
            return { bytes: 1024 * 1024, elapsedMs: 1000 };
          },
          async close() {
            calls.close += 1;
          }
        };
      }
    });

    const records = [node('real.example.com')];
    const result = await runSpeedTestOperator(records, {
      testMode: 'real',
      enableSpeedTest: true,
      timeout: 8000,
      concurrency: 2
    }, { speedTestRunner: runner });

    expect(calls).toEqual({ open: 1, ping: 2, download: 1, close: 1 });
    expect(result[0].name).toBe(records[0].name);
    expect(result[0].url).toBe(records[0].url);
    expect(result[0].metadata).toMatchObject({
      latency: 30,
      speed: 1024,
      speedTestMode: 'real'
    });
  });

  it('marks real ping failures without deleting the node or running the download', async () => {
    let downloaded = false;
    const runner = runnerFor({
      open: async () => ({
        async ping() {
          throw new Error('connection_refused');
        },
        async download() {
          downloaded = true;
          return { bytes: 1, elapsedMs: 1 };
        },
        async close() {}
      })
    });

    const result = await runSpeedTestOperator([node('down.example.com')], {
      testMode: 'real',
      enableSpeedTest: true
    }, { speedTestRunner: runner });

    expect(result).toHaveLength(1);
    expect(downloaded).toBe(false);
    expect(result[0].metadata.latency).toBe(-1);
    expect(result[0].metadata.speed).toBe(0);
    expect(result[0].metadata.latencyError).toBe('connection_refused');
  });

  it('runs TCP mode without touching the proxy runner', async () => {
    let runnerOpened = false;
    const runner = runnerFor({
      open: async () => {
        runnerOpened = true;
        throw new Error('must not be called');
      }
    });

    const result = await runSpeedTestOperator([node('tcp.example.com', 8388)], {
      testMode: 'tcp',
      enableSpeedTest: true
    }, {
      speedTestRunner: runner,
      tcpConnect: async (host, port) => {
        expect(host).toBe('tcp.example.com');
        expect(port).toBe(8388);
        return 18;
      }
    });

    expect(runnerOpened).toBe(false);
    expect(result[0].metadata.latency).toBe(18);
    expect(result[0].metadata.speed).toBe(0);
    expect(result[0].metadata.speedError).toBe('speed_test_requires_real_mode');
  });

  it('marks TCP failures as latency -1', async () => {
    const result = await runSpeedTestOperator([node('tcp-down.example.com', 8388)], {
      testMode: 'tcp'
    }, {
      tcpConnect: async () => {
        throw new Error('econnrefused');
      }
    });

    expect(result[0].metadata.latency).toBe(-1);
    expect(result[0].metadata.latencyError).toBe('econnrefused');
  });

  it('never leaks undefined latency when the connector returns an invalid value', async () => {
    const result = await runSpeedTestOperator([
      node('invalid-a.example.com', 8388),
      node('invalid-b.example.com', 8388)
    ], { testMode: 'tcp', concurrency: 2 }, {
      tcpConnect: async () => undefined
    });

    for (const record of result) {
      expect(typeof record.metadata.latency).toBe('number');
      expect(record.metadata.latency).toBe(-1);
      expect(record.metadata.latencyError).toBe('tcp_invalid_latency');
    }
  });

  it('marks every node with latency -1 when Cloudflare sockets are unavailable', async () => {
    // Force Cloudflare runtime detection; the test environment cannot resolve
    // `cloudflare:sockets`, which must degrade to -1 instead of throwing.
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    expect(isCloudflareRuntime()).toBe(true);

    const result = await runSpeedTestOperator([
      node('cf-a.example.com', 443),
      node('cf-b.example.com', 443)
    ], { testMode: 'tcp', concurrency: 2 });

    expect(result).toHaveLength(2);
    for (const record of result) {
      expect(record.metadata.latency).toBe(-1);
      expect(record.metadata.latencyError).toBe('tcp_unavailable');
    }
  });

  it('fast-fails real ping on Cloudflare without spawning any work', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    let runnerOpened = false;

    const result = await runSpeedTestOperator([node('cf-real.example.com')], {
      testMode: 'real',
      enableSpeedTest: true,
      timeout: 30000
    }, {
      speedTestRunner: null,
      tcpConnect: async () => {
        runnerOpened = true;
        return 10;
      }
    });

    expect(runnerOpened).toBe(false);
    expect(result[0].metadata).toMatchObject({
      latency: -1,
      speed: 0,
      speedTestMode: 'real',
      latencyError: CLOUDFLARE_REAL_PING_ERROR,
      speedError: CLOUDFLARE_REAL_PING_ERROR
    });
  });

  it('isolates failures between nodes', async () => {
    const runner = runnerFor({
      open: async (record) => ({
        async ping() {
          if (record.server.startsWith('bad')) throw new Error('boom');
          return 42;
        },
        async download() {
          return { bytes: 0, elapsedMs: 1 };
        },
        async close() {}
      })
    });

    const result = await runSpeedTestOperator([
      node('good.example.com'),
      node('bad.example.com')
    ], { testMode: 'real', concurrency: 2 }, { speedTestRunner: runner });

    expect(result).toHaveLength(2);
    expect(result[0].metadata.latency).toBe(42);
    expect(result[1].metadata.latency).toBe(-1);
  });

  it('respects the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const runner = runnerFor({
      open: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        return {
          async ping() {
            await new Promise(resolve => setTimeout(resolve, 10));
            return 10;
          },
          async close() {
            active -= 1;
          }
        };
      }
    });

    await runSpeedTestOperator(
      Array.from({ length: 6 }, (_, index) => node(`node${index}.example.com`)),
      { testMode: 'real', concurrency: 2 },
      { speedTestRunner: runner }
    );

    expect(maxActive).toBe(2);
    expect(active).toBe(0);
  });

  it('normalizes invalid parameters to safe defaults', () => {
    expect(normalizeSpeedTestParams({})).toEqual(DEFAULT_SPEED_TEST_PARAMS);
    expect(normalizeSpeedTestParams({ testMode: 'bogus', timeout: -1, concurrency: 999 })).toMatchObject({
      testMode: 'real',
      timeout: 1,
      concurrency: 32
    });
    expect(normalizeSpeedTestParams({ pingUrl: 'file:///etc/passwd' }).pingUrl).toBe(DEFAULT_SPEED_TEST_PARAMS.pingUrl);
    expect(normalizeSpeedTestParams(null)).toEqual(DEFAULT_SPEED_TEST_PARAMS);
  });
});

describe('filter performance thresholds', () => {
  it('keeps only nodes that satisfy latency and speed limits', async () => {
    const runner = runnerFor({
      open: async (record) => ({
        async ping() {
          return record.server.startsWith('fast') ? 80 : 600;
        },
        async download() {
          return record.server.startsWith('fast')
            ? { bytes: 2 * 1024 * 1024, elapsedMs: 1000 }
            : { bytes: 100 * 1024, elapsedMs: 1000 };
        },
        async close() {}
      })
    });

    const urls = [
      node('fast.example.com').url,
      node('slow.example.com').url
    ];

    const result = await runOperatorChain(urls, [
      { type: 'speedtest', params: { testMode: 'real', enableSpeedTest: true } },
      { type: 'filter', params: { maxLatency: 200, minSpeed: 1000 } }
    ], { speedTestRunner: runner });

    expect(result).toHaveLength(1);
    expect(decodeURIComponent(result[0])).toContain('fast.example.com');
  });

  it('filters nodes without speed-test metadata', async () => {
    const urls = [node('untested.example.com').url];

    const result = await runOperatorChain(urls, [
      { type: 'filter', params: { maxLatency: 200 } }
    ]);

    expect(result).toHaveLength(0);
  });

  it('preserves measured metadata on source-operator results', async () => {
    const runner = runnerFor({
      open: async () => ({
        async ping() { return 25; },
        async close() {}
      })
    });

    const result = await applySubscriptionOperators([
      { name: 'Node record.example.com', url: node('record.example.com').url, subscriptionName: 'Airport' }
    ], {
      name: 'Airport',
      operators: [{ type: 'speedtest', params: { testMode: 'real' } }]
    }, { speedTestRunner: runner });

    expect(result[0].metadata.latency).toBe(25);
    expect(result[0].subscriptionName).toBe('Airport');
  });

  it('accepts records as chain input so a filter-only chain can read latency', async () => {
    const records = [
      { ...node('keep.example.com'), metadata: { latency: 40 } },
      { ...node('drop.example.com'), metadata: { latency: 900 } }
    ];

    const result = await runOperatorChain(records, [
      { type: 'filter', params: { maxLatency: 200 } }
    ], { returnRecords: true });

    expect(result).toHaveLength(1);
    expect(result[0].server).toBe('keep.example.com');
    expect(result[0].metadata.latency).toBe(40);
  });

  it('keeps a zero latency node even when speed metadata is missing', async () => {
    const records = [
      { ...node('zero.example.com'), metadata: { latency: 0 } },
      { ...node('slow.example.com'), metadata: { latency: 500 } }
    ];

    const result = await runOperatorChain(records, [
      { type: 'filter', params: { maxLatency: 200 } }
    ], { returnRecords: true });

    expect(result).toHaveLength(1);
    expect(result[0].server).toBe('zero.example.com');
    expect(result[0].metadata.latency).toBe(0);
    expect(result[0].metadata.speed).toBeUndefined();
  });

  it('keeps upstream metadata through a filter-only source operator chain', async () => {
    const result = await applySubscriptionOperators([
      { ...node('keep.example.com'), subscriptionName: 'Airport', metadata: { latency: 30 } },
      { ...node('drop.example.com'), subscriptionName: 'Airport', metadata: { latency: 800 } }
    ], {
      name: 'Airport',
      operators: [{ type: 'filter', params: { maxLatency: 200 } }]
    });

    expect(result).toHaveLength(1);
    expect(result[0].server).toBe('keep.example.com');
    expect(result[0].metadata.latency).toBe(30);
    expect(result[0].subscriptionName).toBe('Airport');
  });

  it('keeps speed-test metadata when a later rename operator rewrites the name', async () => {
    const runner = runnerFor({
      open: async () => ({
        async ping() { return 18; },
        async close() {}
      })
    });

    const records = await runOperatorChain([node('rename.example.com').url], [
      { type: 'speedtest', params: { testMode: 'real' } },
      { type: 'rename', params: { template: { enabled: true, template: 'Renamed {name}' } } }
    ], { speedTestRunner: runner, returnRecords: true });

    expect(records[0].name).toBe('Renamed Node rename.example.com');
    expect(records[0].metadata.latency).toBe(18);
  });

  it('can return enriched records when requested', async () => {
    const runner = runnerFor({
      open: async () => ({
        async ping() { return 12; },
        async close() {}
      })
    });

    const records = await runOperatorChain([node('record.example.com').url], [
      { type: 'speedtest', params: { testMode: 'real' } }
    ], { speedTestRunner: runner, returnRecords: true });

    expect(records[0].metadata.latency).toBe(12);
  });
});

describe('speed test metadata across generation stages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('carries source-level TCP latency into a profile-level filter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response([
      'trojan://pass@fast.example.com:443#Fast',
      'trojan://pass@slow.example.com:443#Slow'
    ].join('\n'), { status: 200 })));

    const result = await generateCombinedNodeList(
      {
        env: {},
        tcpConnect: async (host) => (host.startsWith('fast') ? 50 : 900)
      },
      { enableAccessLog: false, enableFlagEmoji: false },
      'ClashMeta',
      [{
        id: 'sub-a',
        name: 'Airport',
        url: 'https://example.com/sub',
        enabled: true,
        operators: [{ type: 'speedtest', params: { testMode: 'tcp' } }]
      }],
      '',
      {
        enableSubscriptions: false,
        operators: [{ type: 'filter', params: { maxLatency: 200 } }]
      },
      false
    );

    expect(result).toContain('fast.example.com');
    expect(result).not.toContain('slow.example.com');
  });
});

describe('speed test cache and progressive batching', () => {
  beforeEach(() => {
    clearSpeedTestMemoryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSpeedTestMemoryCache();
  });

  it('builds stable cache keys and resolves the TTL', () => {
    expect(buildSpeedTestCacheKey(node('Cache.Example.com', 8443)))
      .toBe('speedtest_cache_cache.example.com:8443');
    expect(buildSpeedTestCacheKey({ server: '[2001:DB8::1]', port: 443 }))
      .toBe('speedtest_cache_2001:db8::1:443');
    expect(buildSpeedTestCacheKey({ server: '', port: 443 })).toBe('');
    expect(resolveSpeedTestCacheTtlMs(30)).toBe(30 * 60 * 1000);
    expect(resolveSpeedTestCacheTtlMs(0)).toBe(0);
    expect(normalizeSpeedTestParams({}).cacheTtlMinutes).toBe(30);
    expect(normalizeSpeedTestParams({ batchSize: 0 }).batchSize).toBe(1);
  });

  it('reuses a fresh cached result and never opens a socket', async () => {
    const adapter = memoryAdapter({
      [buildSpeedTestCacheKey(node('cached.example.com'))]: cacheEntry(40)
    });
    let connects = 0;

    const result = await runSpeedTestOperator([node('cached.example.com')], {
      testMode: 'tcp'
    }, {
      storage: adapter,
      tcpConnect: async () => {
        connects += 1;
        return 10;
      }
    });

    expect(connects).toBe(0);
    expect(result[0].metadata).toMatchObject({
      latency: 40,
      speed: 0,
      speedTestCached: true
    });
    expect(result[0].metadata.speedTestPending).toBeUndefined();
  });

  it('re-tests an expired cache entry and refreshes it', async () => {
    const key = buildSpeedTestCacheKey(node('expired.example.com'));
    const adapter = memoryAdapter({
      [key]: cacheEntry(40, {
        speedTestAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      })
    });
    let connects = 0;

    const result = await runSpeedTestOperator([node('expired.example.com')], {
      testMode: 'tcp'
    }, {
      storage: adapter,
      tcpConnect: async () => {
        connects += 1;
        return 55;
      }
    });

    expect(connects).toBe(1);
    expect(result[0].metadata.latency).toBe(55);
  });

  it('writes measured results through waitUntil and respects the batch size', async () => {
    const adapter = memoryAdapter();
    const scheduled = [];
    let connects = 0;

    const records = [
      node('batch-a.example.com'),
      node('batch-b.example.com'),
      node('batch-c.example.com')
    ];

    const result = await runSpeedTestOperator(records, {
      testMode: 'tcp',
      batchSize: 1
    }, {
      storage: adapter,
      waitUntil: promise => scheduled.push(promise),
      tcpConnect: async () => {
        connects += 1;
        return 20;
      }
    });

    expect(connects).toBe(1);
    expect(result[0].metadata.latency).toBe(20);
    expect(result[1].metadata.speedTestPending).toBe(true);
    expect(result[2].metadata.speedTestPending).toBe(true);
    expect(result[1].metadata.latency).toBeUndefined();

    expect(scheduled).toHaveLength(1);
    await Promise.all(scheduled);
    expect(adapter.store.has(buildSpeedTestCacheKey(records[0]))).toBe(true);
    expect(adapter.store.has(buildSpeedTestCacheKey(records[1]))).toBe(false);
  });

  it('enforces Cloudflare concurrency 2 and a 1500ms timeout', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    expect(isCloudflareRuntime()).toBe(true);

    let active = 0;
    let maxActive = 0;
    const timeouts = [];

    const records = Array.from(
      { length: 5 },
      (_, index) => node(`cf-throttle-${index}.example.com`, 8388)
    );

    await runSpeedTestOperator(records, {
      testMode: 'tcp',
      concurrency: 16,
      timeout: 30000
    }, {
      tcpConnect: async (host, port, timeoutMs) => {
        timeouts.push(timeoutMs);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active -= 1;
        return 12;
      }
    });

    expect(maxActive).toBe(2);
    expect(timeouts).toHaveLength(5);
    for (const timeoutMs of timeouts) {
      expect(timeoutMs).toBeLessThanOrEqual(1500);
      expect(timeoutMs).toBeGreaterThan(0);
    }
  });

  it('tests at most 5 uncached nodes per Cloudflare run', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    let connects = 0;

    const records = Array.from(
      { length: 8 },
      (_, index) => node(`cf-batch-${index}.example.com`, 8388)
    );

    const result = await runSpeedTestOperator(records, {
      testMode: 'tcp',
      concurrency: 8
    }, {
      tcpConnect: async () => {
        connects += 1;
        return 15;
      }
    });

    expect(connects).toBe(5);
    expect(result.filter(record => record.metadata.speedTestPending === true)).toHaveLength(3);
    expect(result.filter(record => record.metadata.latency === 15)).toHaveLength(5);
  });

  it('skips real testing when a single run would plan more than 20 tests', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    let connects = 0;

    const records = Array.from(
      { length: 26 },
      (_, index) => node(`cf-safety-${index}.example.com`, 8388)
    );

    const result = await runSpeedTestOperator(records, {
      testMode: 'tcp',
      batchSize: 25
    }, {
      tcpConnect: async () => {
        connects += 1;
        return 15;
      }
    });

    expect(connects).toBe(0);
    for (const record of result) {
      expect(record.metadata.speedTestPending).toBe(true);
      expect(record.metadata.speedTestDeferredReason).toBe('speed_test_safety_threshold');
    }
  });

  it('advances through a large node list across successive runs', async () => {
    const adapter = memoryAdapter();
    const records = Array.from(
      { length: 6 },
      (_, index) => node(`progressive-${index}.example.com`, 8388)
    );
    const testedHosts = [];

    const runOnce = () => runSpeedTestOperator(records, {
      testMode: 'tcp',
      batchSize: 2
    }, {
      storage: adapter,
      tcpConnect: async (host) => {
        testedHosts.push(host);
        return 11;
      }
    });

    await runOnce();
    await runOnce();
    await runOnce();

    expect(testedHosts).toEqual([
      'progressive-0.example.com',
      'progressive-1.example.com',
      'progressive-2.example.com',
      'progressive-3.example.com',
      'progressive-4.example.com',
      'progressive-5.example.com'
    ]);
    expect(adapter.store.size).toBe(6);
  });

  it('serves cached real-mode results on Cloudflare instead of failing fast', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    const adapter = memoryAdapter({
      [buildSpeedTestCacheKey(node('cf-real-cached.example.com'))]: cacheEntry(33, {
        speedTestMode: 'real'
      })
    });

    const result = await runSpeedTestOperator([node('cf-real-cached.example.com')], {
      testMode: 'real',
      enableSpeedTest: true
    }, { storage: adapter, speedTestRunner: null });

    expect(result[0].metadata).toMatchObject({
      latency: 33,
      speedTestCached: true,
      speedTestMode: 'real'
    });
    expect(result[0].metadata.latencyError).toBeUndefined();
  });

  it('lets a filter-only chain read measurements from the cache', async () => {
    const adapter = memoryAdapter({
      [buildSpeedTestCacheKey(node('cached-fast.example.com'))]: cacheEntry(50),
      [buildSpeedTestCacheKey(node('cached-slow.example.com'))]: cacheEntry(900)
    });

    const records = await runOperatorChain([
      node('cached-fast.example.com'),
      node('cached-slow.example.com')
    ], [
      { type: 'filter', params: { maxLatency: 200 } }
    ], { storage: adapter, returnRecords: true });

    expect(records).toHaveLength(1);
    expect(records[0].server).toBe('cached-fast.example.com');
    expect(records[0].metadata.speedTestCached).toBe(true);
  });

  it('honours the untested policy when no measurement exists', async () => {
    const urls = [node('untested-policy.example.com').url];

    const excluded = await runOperatorChain(urls, [
      { type: 'filter', params: { maxLatency: 200 } }
    ]);
    expect(excluded).toHaveLength(0);

    const included = await runOperatorChain(urls, [
      { type: 'filter', params: { maxLatency: 200, untestedPolicy: 'include' } }
    ]);
    expect(included).toHaveLength(1);
  });
});
