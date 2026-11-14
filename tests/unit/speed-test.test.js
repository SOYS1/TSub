import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEED_TEST_PARAMS,
  normalizeSpeedTestParams,
  runSpeedTestOperator
} from '../../functions/utils/speed-test.js';
import { runOperatorChain } from '../../functions/utils/operator-runner.js';
import { applySubscriptionOperators } from '../../functions/modules/subscription/source-operators.js';

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
