import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeSafeRegex,
  compileSafeRegex,
  compileSafeRegexList,
  escapeRegExp,
  isSafeRegexPattern
} from '../../functions/utils/safe-regex.js';
import { buildSafeRegex } from '../../functions/services/subscription-service.js';
import { buildSafeRegex as buildNodeCleanerRegex } from '../../functions/modules/utils/node-cleaner.js';
import { matchesRegexRules, applyRegexRename } from '../../functions/utils/node-transformer.js';

describe('safe regex validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts common non-catastrophic patterns', () => {
    for (const pattern of ['US|HK', '^HK$', '(香港|台湾)', '\\d{1,3}\\.\\d{1,3}', '^HK.*IPLC$']) {
      expect(analyzeSafeRegex(pattern)).toEqual({ safe: true });
      expect(isSafeRegexPattern(pattern)).toBe(true);
      expect(compileSafeRegex(pattern)).toBeInstanceOf(RegExp);
    }
  });

  it('rejects catastrophic backtracking shapes', () => {
    const patterns = [
      '(a+)+$',
      '(a*)*',
      '(a|aa)+',
      '(\\w+\\s?)*',
      'a*a*a*b',
      '(?=a)a',
      '(a)\\1',
      'a{1,1000}'
    ];
    for (const pattern of patterns) {
      expect(analyzeSafeRegex(pattern).safe).toBe(false);
      expect(compileSafeRegex(pattern)).toBeNull();
    }
  });

  it('rejects overlong patterns', () => {
    expect(analyzeSafeRegex('x'.repeat(101))).toEqual({ safe: false, reason: 'too_long' });
    expect(compileSafeRegex('x'.repeat(101))).toBeNull();
  });

  it('escapes regex metacharacters for literal fallbacks', () => {
    expect(escapeRegExp('(a+)+$')).toBe('\\(a\\+\\)\\+\\$');
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });

  it('compiles a list and keeps safe alternation semantics', () => {
    const regex = compileSafeRegexList(['^HK$', 'US|JP']);
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex.test('HK')).toBe(true);
    expect(regex.test('US')).toBe(true);
    expect(regex.test('JP')).toBe(true);
    expect(regex.test('HK 01')).toBe(false);
  });

  it('degrades unsafe patterns to literal matches', () => {
    const onDegrade = vi.fn();
    const regex = compileSafeRegexList(['(a+)+$'], 'i', { onDegrade });
    expect(onDegrade).toHaveBeenCalledWith('(a+)+$', 'nested_quantifier');
    expect(regex).toBeInstanceOf(RegExp);
    // Matches the literal text, not a long run of "a".
    expect(regex.test('(a+)+$')).toBe(true);
    expect(regex.test('a'.repeat(10000))).toBe(false);
  });

  it('enforces per-rule and total length limits', () => {
    const onDegrade = vi.fn();
    const overlongRule = 'x'.repeat(101);
    const regex = compileSafeRegexList([overlongRule, 'HK'], 'i', { onDegrade });
    expect(onDegrade).toHaveBeenCalledWith(overlongRule, 'too_long');
    expect(regex.test('HK')).toBe(true);

    const manyRules = Array.from({ length: 7 }, (_, index) => `${String(index).padStart(3, '0')}${'x'.repeat(97)}`);
    const limited = compileSafeRegexList(manyRules, 'i', { onDegrade: vi.fn() });
    expect(limited).toBeInstanceOf(RegExp);
    expect(manyRules.join('').length).toBeGreaterThan(500);
  });

  it('returns null for empty rule lists', () => {
    expect(compileSafeRegexList([])).toBeNull();
    expect(compileSafeRegexList(['', '   '])).toBeNull();
  });
});

describe('subscription buildSafeRegex', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches literal names and safe alternation', () => {
    const regex = buildSafeRegex(['香港', 'HK|US']);
    expect(regex.test('香港 IPLC 01')).toBe(true);
    expect(regex.test('US Node')).toBe(true);
    expect(regex.test('JP Node')).toBe(false);
  });

  it('supports anchors without breaking alternation', () => {
    const regex = buildSafeRegex(['^HK$', '^US']);
    expect(regex.test('HK')).toBe(true);
    expect(regex.test('US Node')).toBe(true);
    expect(regex.test('HK 01')).toBe(false);
  });

  it('does not hang on catastrophic patterns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const regex = buildSafeRegex(['(a+)+$']);
    const started = Date.now();
    expect(regex.test('a'.repeat(20000))).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(warn).toHaveBeenCalled();
  });

  it('returns null when no usable rule remains', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(buildSafeRegex([])).toBeNull();
    expect(buildSafeRegex(['x'.repeat(200)])).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('applies the same protection in node-cleaner', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const regex = buildNodeCleanerRegex(['(a+)+$']);
    expect(regex.test('a'.repeat(20000))).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('operator filter regex safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps matching safe regex rules', () => {
    expect(matchesRegexRules('HK IPLC 01', [{ pattern: '^HK', flags: 'i' }])).toBe(true);
    expect(matchesRegexRules('US Node', [{ pattern: 'HK|US', flags: 'i' }])).toBe(true);
    expect(matchesRegexRules('JP Node', [{ pattern: 'HK|US', flags: 'i' }])).toBe(false);
  });

  it('falls back to a literal match for unsafe rules instead of hanging', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const started = Date.now();
    expect(matchesRegexRules('a'.repeat(20000), [{ pattern: '(a+)+$', flags: 'i' }])).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(warn).toHaveBeenCalled();

    // The literal fallback still allows a user to filter a node whose name
    // literally contains the pattern.
    expect(matchesRegexRules('(a+)+$', [{ pattern: '(a+)+$', flags: 'i' }])).toBe(true);
  });

  it('skips unsafe rename rules but keeps safe ones working', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const record = {};
    expect(applyRegexRename('HK 01', [{ pattern: '(a+)+$', replacement: 'X', flags: 'gi' }], record)).toBe('HK 01');
    expect(warn).toHaveBeenCalled();

    expect(applyRegexRename('HK 01', [{ pattern: 'HK (\\d+)', replacement: 'Hong Kong $1', flags: 'gi' }], record)).toBe('Hong Kong 01');
    expect(record.regexGroups).toMatchObject({ 1: '01' });
  });
});
