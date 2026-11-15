import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAFE_REGEX_CACHE_LIMIT,
  clearSafeRegexCache,
  compileSafeRegex,
  getSafeRegexCacheStats
} from '../../functions/utils/safe-regex.js';
import {
  evaluateDslExpression,
  matchesDslCondition,
  renderDslTemplate
} from '../../functions/utils/expression-dsl.js';

describe('safe regex compilation cache', () => {
  beforeEach(() => {
    clearSafeRegexCache();
  });

  it('compiles a repeated pattern only once', () => {
    const first = compileSafeRegex('US|HK', 'i');
    const second = compileSafeRegex('US|HK', 'i');

    expect(first).toBeInstanceOf(RegExp);
    expect(second).toBe(first);
    expect(getSafeRegexCacheStats()).toMatchObject({
      size: 1,
      hits: 1,
      misses: 1,
      compilations: 1
    });
  });

  it('caches negative results for unsafe patterns', () => {
    expect(compileSafeRegex('(a+)+$', 'i')).toBeNull();
    expect(compileSafeRegex('(a+)+$', 'i')).toBeNull();

    expect(getSafeRegexCacheStats()).toMatchObject({
      size: 1,
      hits: 1,
      misses: 1,
      compilations: 1
    });
  });

  it('separates cache entries by flags and length limit', () => {
    const insensitive = compileSafeRegex('HK', 'i');
    const sensitive = compileSafeRegex('HK', '');
    const shortLimit = compileSafeRegex('HK', 'i', { maxPatternLength: 1 });

    expect(insensitive).not.toBe(sensitive);
    expect(shortLimit).toBeNull();
    expect(getSafeRegexCacheStats().size).toBe(2);
  });

  it('resets mutable lastIndex for global or sticky regexes', () => {
    const first = compileSafeRegex('HK', 'g');

    expect(first.test('HK HK')).toBe(true);
    expect(first.lastIndex).toBe(2);

    // The cached instance is reset before it is handed out again, so the next
    // caller starts from the beginning instead of inheriting lastIndex = 2.
    const second = compileSafeRegex('HK', 'g');
    expect(second).toBe(first);
    expect(second.lastIndex).toBe(0);
    expect(second.test('HK HK')).toBe(true);
  });

  it('keeps the cache bounded under many distinct patterns', () => {
    for (let index = 0; index < SAFE_REGEX_CACHE_LIMIT + 100; index += 1) {
      compileSafeRegex(`node-${index}`, 'i');
    }
    expect(getSafeRegexCacheStats().size).toBe(SAFE_REGEX_CACHE_LIMIT);
  });

  it('preserves existing safe-regex semantics', () => {
    expect(compileSafeRegex('^HK$', 'i').test('HK')).toBe(true);
    expect(compileSafeRegex('^HK$', 'i').test('HK 01')).toBe(false);
    expect(compileSafeRegex('US|HK', 'i').test('US Node')).toBe(true);
    expect(compileSafeRegex('(香港|台湾)', 'i').test('台湾 01')).toBe(true);
    expect(compileSafeRegex('\\d{1,3}', 'i').test('IPLC 100')).toBe(true);
  });
});

describe('expression DSL regex cache', () => {
  beforeEach(() => {
    clearSafeRegexCache();
  });

  it('reuses compiled regexes across evaluations', () => {
    expect(evaluateDslExpression("match(name, 'US|HK', 'i')", { name: 'US Node' })).toBe(true);
    expect(evaluateDslExpression("match(name, 'US|HK', 'i')", { name: 'HK Node' })).toBe(true);

    expect(getSafeRegexCacheStats()).toMatchObject({
      size: 1,
      hits: 1,
      misses: 1,
      compilations: 1
    });
  });

  it('keeps replace semantics and captures working', () => {
    expect(renderDslTemplate("{replace(name, 'HK (\\d+)', 'Hong Kong $1', 'g')}", { name: 'HK 01' }))
      .toBe('Hong Kong 01');
  });

  it('degrades unsafe DSL patterns instead of hanging', () => {
    const started = Date.now();
    expect(matchesDslCondition({ name: 'a'.repeat(20000) }, {
      field: 'name',
      op: 'match',
      value: '(a+)+$'
    })).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
