import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUDFLARE_REAL_PING_ERROR,
  DEFAULT_SPEED_TEST_PARAMS,
  isCloudflareRuntime,
  normalizeSpeedTestParams,
  runSpeedTestOperator
} from '../../functions/utils/speed-test.js';
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
