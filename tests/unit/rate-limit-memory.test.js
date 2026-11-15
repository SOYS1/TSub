import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RATE_LIMIT_MEMORY_MAX_ENTRIES,
  RATE_LIMIT_MEMORY_TTL,
  clearRateLimitMemory,
  getRateLimitMemorySize,
  hasRateLimitMemoryEntry,
  pruneRateLimitMemory,
  recordRateLimitFailure
} from '../../functions/modules/rate-limit.js';

const options = { limit: 1000, windowMs: 60_000 };

async function recordKey(key, now = Date.now()) {
  return recordRateLimitFailure({
    key,
    entry: null,
    now,
    adapter: null
  }, options);
}

describe('rate limit memory bounds', () => {
  beforeEach(() => {
    clearRateLimitMemory();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the memory fallback at or below the configured cap', async () => {
    const now = Date.now();
    for (let index = 0; index < RATE_LIMIT_MEMORY_MAX_ENTRIES + 300; index += 1) {
      await recordKey(`limit-key-${index}`, now);
    }

    expect(getRateLimitMemorySize()).toBeLessThanOrEqual(RATE_LIMIT_MEMORY_MAX_ENTRIES);
    expect(getRateLimitMemorySize()).toBe(RATE_LIMIT_MEMORY_MAX_ENTRIES);
  });

  it('evicts the oldest entries first', async () => {
    const now = Date.now();
    for (let index = 0; index < RATE_LIMIT_MEMORY_MAX_ENTRIES + 1; index += 1) {
      await recordKey(`limit-key-${index}`, now);
    }

    expect(hasRateLimitMemoryEntry('limit-key-0')).toBe(false);
    expect(hasRateLimitMemoryEntry(`limit-key-${RATE_LIMIT_MEMORY_MAX_ENTRIES}`)).toBe(true);
    expect(getRateLimitMemorySize()).toBe(RATE_LIMIT_MEMORY_MAX_ENTRIES);
  });

  it('drops entries whose retention window has elapsed', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(start);

    await recordKey('ttl-key');
    expect(getRateLimitMemorySize()).toBe(1);

    vi.setSystemTime(new Date(start.getTime() + RATE_LIMIT_MEMORY_TTL + 1));
    pruneRateLimitMemory();

    expect(getRateLimitMemorySize()).toBe(0);
  });

  it('keeps longer caller windows alive beyond the default TTL', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(start);

    const dayWindow = 24 * 60 * 60 * 1000;
    await recordRateLimitFailure({
      key: 'daily-key',
      entry: null,
      now: start.getTime(),
      adapter: null
    }, { limit: 20, windowMs: dayWindow });

    vi.setSystemTime(new Date(start.getTime() + RATE_LIMIT_MEMORY_TTL + 1));
    pruneRateLimitMemory();
    expect(getRateLimitMemorySize()).toBe(1);

    vi.setSystemTime(new Date(start.getTime() + dayWindow + 1));
    pruneRateLimitMemory();
    expect(getRateLimitMemorySize()).toBe(0);
  });
});
