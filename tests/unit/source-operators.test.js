import { describe, expect, it } from 'vitest';
import {
  applySubscriptionOperators,
  hasEnabledRenameOperator,
  normalizeSourceOperators,
  resolveSubscriptionOperators
} from '../../functions/modules/subscription/source-operators.js';

function createRenameOperator(params) {
  return [{ id: 'rename-1', type: 'rename', enabled: true, params }];
}

describe('subscription source operators', () => {
  it('normalizes undefined, null, invalid and string operator payloads', () => {
    expect(normalizeSourceOperators(undefined)).toEqual([]);
    expect(normalizeSourceOperators(null)).toEqual([]);
    expect(normalizeSourceOperators({ rename: { enabled: false } })).toEqual([]);
    expect(normalizeSourceOperators('not-json')).toEqual([]);
    expect(normalizeSourceOperators('[{"type":"rename"}]')).toEqual([{ type: 'rename' }]);
  });

  it('prefers sub.operators and falls back to enabled nodeTransform.operators', () => {
    expect(resolveSubscriptionOperators({
      operators: [{ type: 'rename' }],
      nodeTransform: { enabled: true, operators: [{ type: 'filter' }] }
    })).toEqual([{ type: 'rename' }]);

    expect(resolveSubscriptionOperators({
      operators: [],
      nodeTransform: { enabled: true, operators: [{ type: 'rename' }] }
    })).toEqual([{ type: 'rename' }]);

    expect(resolveSubscriptionOperators({
      operators: [],
      nodeTransform: { enabled: false, operators: [{ type: 'rename' }] }
    })).toEqual([]);
  });

  it('detects only enabled rename operators with effective rules', () => {
    expect(hasEnabledRenameOperator({})).toBe(false);
    expect(hasEnabledRenameOperator({
      operators: [{ type: 'rename', enabled: false, params: { template: { enabled: true, template: '{name}-x' } } }]
    })).toBe(false);
    expect(hasEnabledRenameOperator({
      operators: [{ type: 'rename', enabled: true, params: { regex: { enabled: true, rules: [] } } }]
    })).toBe(false);
    expect(hasEnabledRenameOperator({
      operators: createRenameOperator({ regex: { enabled: true, rules: [{ pattern: 'HK' }] } })
    })).toBe(true);
    expect(hasEnabledRenameOperator({
      operators: createRenameOperator({ template: { enabled: true, template: '{emoji}{regionZh}-{index:2}' } })
    })).toBe(true);
  });

  it('returns nodes unchanged when no operators are configured', async () => {
    const nodes = [{ name: 'HK', url: 'trojan://pass@example.com:443#HK' }];
    await expect(applySubscriptionOperators(nodes, {}, {})).resolves.toBe(nodes);
  });

  it('applies rename rules and refreshes the parsed node name', async () => {
    const nodes = [{ name: 'HK', url: 'trojan://pass@example.com:443#HK', subscriptionName: 'Airport' }];
    const result = await applySubscriptionOperators(nodes, {
      name: 'Airport',
      operators: createRenameOperator({
        regex: { enabled: true, rules: [{ pattern: 'HK', replacement: 'Hong Kong' }] }
      })
    }, {});

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Hong Kong');
    expect(result[0].url).toContain('#Hong%20Kong');
    expect(result[0].subscriptionName).toBe('Airport');
  });

  it('renames the VMess ps field through the URL payload', async () => {
    const payload = {
      v: '2',
      ps: 'Raw VMess',
      add: 'example.com',
      port: '443',
      id: '11111111-1111-1111-1111-111111111111',
      aid: '0',
      net: 'ws',
      type: 'none',
      host: '',
      path: '/',
      tls: ''
    };
    const url = `vmess://${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
    const result = await applySubscriptionOperators([
      { name: 'Raw VMess', url, subscriptionName: 'Airport' }
    ], {
      name: 'Airport',
      operators: createRenameOperator({
        regex: { enabled: true, rules: [{ pattern: 'Raw', replacement: 'Renamed' }] }
      })
    }, {});

    expect(result[0].name).toBe('Renamed VMess');
    const encoded = result[0].url.slice('vmess://'.length);
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    expect(decoded.ps).toBe('Renamed VMess');
  });
});
