/**
 * Shared safe regular-expression helpers.
 *
 * User supplied include / exclude / rename patterns are executed inside the
 * Worker. A catastrophic pattern such as `(a+)+$` can pin the CPU until the
 * request times out, so every user pattern goes through this module first.
 *
 * Two layers of protection:
 *   1. Hard limits on pattern length, rule count and total input size.
 *   2. A conservative syntax validator that rejects the constructs responsible
 *      for catastrophic backtracking (nested / adjacent unbounded quantifiers,
 *      quantified groups with alternation, backreferences, lookarounds).
 *
 * Patterns that cannot be proven safe are degraded to a literal match instead
 * of being executed as a regex, so filtering still works and never hangs.
 */

export const REGEX_LIMITS = Object.freeze({
    /** Maximum characters for a single user pattern. */
    maxPatternLength: 100,
    /** Maximum characters for all patterns combined. */
    maxTotalPatternLength: 500,
    /** Maximum number of patterns combined into one expression. */
    maxRules: 50,
    /** Maximum characters of node text tested by a regex. */
    maxInputLength: 512,
    /** Maximum unbounded quantifiers (`*`, `+`, `{n,}`) per pattern. */
    maxUnboundedQuantifiers: 2,
    /** Maximum quantifiers of any kind per pattern. */
    maxTotalQuantifiers: 20,
    /** Maximum bounded repetition upper limit, e.g. `{1,100}`. */
    maxRepetitionBound: 100
});

export function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readQuantifier(pattern, index) {
    const char = pattern[index];
    if (char === '*' || char === '+' || char === '?') {
        return {
            length: 1,
            unbounded: char !== '?',
            tooLarge: false
        };
    }
    if (char !== '{') return null;

    const close = pattern.indexOf('}', index + 1);
    if (close === -1) return null;
    const body = pattern.slice(index + 1, close);
    if (!/^\d+(?:,\d*)?$/.test(body)) return null;

    const [minRaw, maxRaw] = body.split(',');
    const min = Number(minRaw);
    const max = maxRaw === undefined || maxRaw === '' ? Infinity : Number(maxRaw);
    if (min > REGEX_LIMITS.maxRepetitionBound || max > REGEX_LIMITS.maxRepetitionBound) {
        return { length: close - index + 1, unbounded: max === Infinity, tooLarge: true };
    }
    return {
        length: close - index + 1,
        unbounded: max === Infinity,
        tooLarge: false
    };
}

/**
 * Conservatively decide whether a user pattern is safe to execute.
 *
 * @param {string} pattern
 * @returns {{ safe: boolean, reason?: string }}
 */
export function analyzeSafeRegex(pattern) {
    const source = typeof pattern === 'string' ? pattern : '';
    if (!source) return { safe: false, reason: 'empty' };
    if (source.length > REGEX_LIMITS.maxPatternLength) return { safe: false, reason: 'too_long' };

    // Backreferences, lookarounds, conditionals and recursion are either
    // exponential by nature or hard to reason about. Reject them.
    if (/\\[1-9]/.test(source) || /\\k</.test(source)) return { safe: false, reason: 'backreference' };
    if (/\(\?<?[=!]/.test(source)) return { safe: false, reason: 'lookaround' };
    if (/\(\?[>R&]/.test(source) || /\(\?\(/.test(source)) return { safe: false, reason: 'special_group' };

    const stack = [];
    let totalQuantifiers = 0;
    let unboundedQuantifiers = 0;
    let index = 0;

    while (index < source.length) {
        const char = source[index];

        if (char === '\\') {
            index += 2;
            continue;
        }

        if (char === '[') {
            index += 1;
            while (index < source.length && source[index] !== ']') {
                if (source[index] === '\\') index += 1;
                index += 1;
            }
            if (index >= source.length) return { safe: false, reason: 'unbalanced_class' };
            index += 1;
            continue;
        }

        if (char === '(') {
            stack.push({ hasQuantifier: false, hasAlternation: false });
            index += 1;
            // Skip group prefixes so `?:`, `?<name>` are not read as quantifiers.
            if (source[index] === '?') {
                if (source[index + 1] === ':') {
                    index += 2;
                } else if (source[index + 1] === '<') {
                    const close = source.indexOf('>', index + 2);
                    if (close === -1) return { safe: false, reason: 'unbalanced_group' };
                    index = close + 1;
                } else {
                    // Lookarounds / special groups were rejected above.
                    index += 1;
                }
            }
            continue;
        }

        if (char === ')') {
            if (stack.length === 0) return { safe: false, reason: 'unbalanced_group' };
            const group = stack.pop();
            const quantifier = readQuantifier(source, index + 1);
            if (quantifier?.tooLarge) return { safe: false, reason: 'repetition_too_large' };

            const quantified = Boolean(quantifier);
            if (quantified) {
                // `(a+)+`, `(a|b)+`, `(\w+\s?)*` — the classic ReDoS shapes.
                if (group.hasQuantifier || group.hasAlternation) {
                    return { safe: false, reason: 'nested_quantifier' };
                }
                totalQuantifiers += 1;
                if (quantifier.unbounded) unboundedQuantifiers += 1;
                index += 1 + quantifier.length;
            } else {
                index += 1;
            }

            if (stack.length > 0) {
                const parent = stack[stack.length - 1];
                if (group.hasQuantifier) parent.hasQuantifier = true;
                if (group.hasAlternation) parent.hasAlternation = true;
                if (quantified) parent.hasQuantifier = true;
            }
            continue;
        }

        if (char === '|') {
            if (stack.length > 0) stack[stack.length - 1].hasAlternation = true;
            index += 1;
            continue;
        }

        const quantifier = readQuantifier(source, index);
        if (quantifier) {
            if (quantifier.tooLarge) return { safe: false, reason: 'repetition_too_large' };
            totalQuantifiers += 1;
            if (quantifier.unbounded) unboundedQuantifiers += 1;
            if (stack.length > 0) stack[stack.length - 1].hasQuantifier = true;
            index += quantifier.length;
            continue;
        }

        index += 1;
    }

    if (stack.length > 0) return { safe: false, reason: 'unbalanced_group' };
    if (unboundedQuantifiers > REGEX_LIMITS.maxUnboundedQuantifiers) {
        return { safe: false, reason: 'too_many_unbounded_quantifiers' };
    }
    if (totalQuantifiers > REGEX_LIMITS.maxTotalQuantifiers) {
        return { safe: false, reason: 'too_many_quantifiers' };
    }
    return { safe: true };
}

export function isSafeRegexPattern(pattern) {
    return analyzeSafeRegex(pattern).safe;
}

/**
 * Bounded cache for compiled user regexes.
 *
 * The same handful of include / exclude / rename rules is evaluated against
 * every node, so without a cache the validator and `new RegExp()` run tens of
 * thousands of times per request. Keys include the effective length limit so
 * custom callers never receive a result compiled under different limits.
 */
export const SAFE_REGEX_CACHE_LIMIT = 256;
const regexCache = new Map();
const regexCacheStats = { hits: 0, misses: 0, compilations: 0 };

function cacheKeyFor(source, flags, maxLength) {
    return `${maxLength}\u0000${flags}\u0000${source}`;
}

function readCachedRegex(key) {
    if (!regexCache.has(key)) return { hit: false, value: null };
    const value = regexCache.get(key);
    // Refresh recency so the LRU eviction removes genuinely cold entries.
    regexCache.delete(key);
    regexCache.set(key, value);
    regexCacheStats.hits += 1;
    return { hit: true, value };
}

function writeCachedRegex(key, value) {
    if (regexCache.has(key)) regexCache.delete(key);
    regexCache.set(key, value);
    if (regexCache.size > SAFE_REGEX_CACHE_LIMIT) {
        regexCache.delete(regexCache.keys().next().value);
    }
}

/**
 * Global / sticky regexes carry mutable `lastIndex` state. Consumers use the
 * compiled regex synchronously, so resetting before every return is enough to
 * stop one node (or request) from inheriting another's match position.
 */
function prepareRegexForUse(regex) {
    if (regex && (regex.global || regex.sticky)) regex.lastIndex = 0;
    return regex;
}

/** Clear the compiled-regex cache and its instrumentation counters. */
export function clearSafeRegexCache() {
    regexCache.clear();
    regexCacheStats.hits = 0;
    regexCacheStats.misses = 0;
    regexCacheStats.compilations = 0;
}

/** Cache instrumentation, primarily for tests and diagnostics. */
export function getSafeRegexCacheStats() {
    return { size: regexCache.size, ...regexCacheStats };
}

/**
 * Compile a single user pattern. Returns null when the pattern is invalid,
 * too long, or not provably safe.
 *
 * Results are memoized: repeated calls with the same source / flags / limit
 * skip both the validator and `new RegExp()`.
 */
export function compileSafeRegex(pattern, flags = 'i', options = {}) {
    const source = typeof pattern === 'string' ? pattern.trim() : '';
    if (!source) return null;
    const maxLength = options.maxPatternLength ?? REGEX_LIMITS.maxPatternLength;
    if (source.length > maxLength) return null;

    const key = cacheKeyFor(source, flags, maxLength);
    const cached = readCachedRegex(key);
    if (cached.hit) return prepareRegexForUse(cached.value);

    regexCacheStats.misses += 1;
    regexCacheStats.compilations += 1;

    let compiled = null;
    if (analyzeSafeRegex(source).safe) {
        try {
            compiled = new RegExp(source, flags);
        } catch {
            compiled = null;
        }
    }

    writeCachedRegex(key, compiled);
    return prepareRegexForUse(compiled);
}

/**
 * Compile a list of user patterns into one alternation.
 *
 * Safe patterns keep their regex meaning. Unsafe / invalid patterns are
 * escaped and matched literally, so the filter still behaves predictably
 * without ever running a catastrophic expression.
 *
 * @param {string[]} patterns
 * @param {string} flags
 * @param {{ maxRules?: number, maxPatternLength?: number, maxTotalPatternLength?: number, onDegrade?: (pattern: string, reason: string) => void }} [options]
 * @returns {RegExp|null}
 */
export function compileSafeRegexList(patterns, flags = 'i', options = {}) {
    if (!Array.isArray(patterns)) return null;

    const maxRules = options.maxRules ?? REGEX_LIMITS.maxRules;
    const maxPatternLength = options.maxPatternLength ?? REGEX_LIMITS.maxPatternLength;
    const maxTotalPatternLength = options.maxTotalPatternLength ?? REGEX_LIMITS.maxTotalPatternLength;
    const onDegrade = typeof options.onDegrade === 'function' ? options.onDegrade : null;

    const fragments = [];
    let totalLength = 0;

    for (const raw of patterns) {
        if (typeof raw !== 'string') continue;
        const pattern = raw.trim();
        if (!pattern) continue;

        if (pattern.length > maxPatternLength) {
            onDegrade?.(pattern, 'too_long');
            continue;
        }
        if (fragments.length >= maxRules) {
            onDegrade?.(pattern, 'too_many_rules');
            break;
        }
        if (totalLength + pattern.length > maxTotalPatternLength) {
            onDegrade?.(pattern, 'total_too_long');
            break;
        }

        const analysis = analyzeSafeRegex(pattern);
        if (analysis.safe) {
            fragments.push(`(?:${pattern})`);
        } else {
            // Degrade to a literal match instead of executing a dangerous regex.
            onDegrade?.(pattern, analysis.reason || 'unsafe');
            fragments.push(escapeRegExp(pattern));
        }
        totalLength += pattern.length;
    }

    if (fragments.length === 0) return null;
    try {
        return new RegExp(fragments.join('|'), flags);
    } catch {
        return null;
    }
}
