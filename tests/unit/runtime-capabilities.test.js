import { describe, expect, it } from 'vitest';
import { resolveSpeedTestSupport } from '../../src/lib/runtime-capabilities.js';

describe('speed-test runtime capabilities', () => {
  it('fails open when capabilities are unavailable', () => {
    expect(resolveSpeedTestSupport(null)).toEqual({
      tcpPing: true,
      realPing: true,
      download: true
    });
  });

  it('only enables TCP ping on Cloudflare', () => {
    expect(resolveSpeedTestSupport({
      platform: 'cloudflare',
      features: { speedTest: { tcpPing: true, realPing: false, download: false } }
    })).toEqual({
      tcpPing: true,
      realPing: false,
      download: false
    });
  });

  it('enables every layer on the self-hosted server', () => {
    expect(resolveSpeedTestSupport({
      platform: 'server',
      features: { speedTest: { tcpPing: true, realPing: true, download: true } }
    })).toEqual({
      tcpPing: true,
      realPing: true,
      download: true
    });
  });

  it('falls back to the platform label when features.speedTest is missing', () => {
    expect(resolveSpeedTestSupport({ platform: 'cloudflare' })).toEqual({
      tcpPing: true,
      realPing: false,
      download: false
    });
    expect(resolveSpeedTestSupport({ platform: 'server' })).toEqual({
      tcpPing: true,
      realPing: true,
      download: true
    });
  });
});
