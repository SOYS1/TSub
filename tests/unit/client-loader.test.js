import { describe, expect, it } from 'vitest';
import {
  detectClientConfigType,
  loadClientParser,
  looksLikeSurgeConfig,
  parseClientConfig,
  parseSurgeConfigAsync
} from '../../src/utils/protocols/client-loader.js';

describe('lazy client config loader', () => {
  it('detects the same formats as the previous synchronous parser', () => {
    expect(detectClientConfigType('[Proxy]\nss=Test SS,1.2.3.4,8388,aes-256-gcm,password123')).toBe('surge');
    expect(detectClientConfigType('[Proxy]\nTest SS = Shadowsocks, 1.2.3.4, 8388, aes-128-gcm, password123')).toBe('loon');
    expect(detectClientConfigType('[server_local]\nshadowsocks=Test SS, 1.2.3.4, 443, aes-128-gcm, password')).toBe('quantumultx');
    expect(detectClientConfigType('ss://YWVzLTI1Ni1nY206cGFzcw@1.2.3.4:443#HK')).toBe('unknown');
  });

  it('only treats named Surge lines as Surge configs', () => {
    expect(looksLikeSurgeConfig('HK-01 = ss, 1.2.3.4, 443, encrypt-method=aes-256-gcm, password=test')).toBe(true);
    expect(looksLikeSurgeConfig('HK-01 = trojan, 1.2.3.4, 443, password=test')).toBe(true);
    expect(looksLikeSurgeConfig('ss=HK-01, 1.2.3.4, 443, aes-256-gcm, password=test')).toBe(true);
    expect(looksLikeSurgeConfig('ss://YWVzLTI1Ni1nY206cGFzcw@1.2.3.4:443#HK')).toBe(false);
    expect(looksLikeSurgeConfig('https://example.com/sub')).toBe(false);
  });

  it('loads and memoizes the parser for a client', async () => {
    const first = await loadClientParser('surge');
    const second = await loadClientParser('surge');

    expect(typeof first).toBe('function');
    expect(second).toBe(first);
    expect(await loadClientParser('unknown-client')).toBeNull();
  });

  it('parses Surge snippets asynchronously', async () => {
    const nodes = await parseSurgeConfigAsync(
      'HK-01 = ss, 1.2.3.4, 443, encrypt-method=aes-256-gcm, password=test'
    );

    expect(nodes).toHaveLength(1);
    expect(nodes[0].url).toContain('ss://');
    expect(nodes[0].protocol).toBe('ss');
  });

  it('parses detected configs asynchronously', async () => {
    const result = await parseClientConfig(
      '[Proxy]\nTest SS = Shadowsocks, 1.2.3.4, 8388, aes-128-gcm, password123'
    );

    expect(result.client).toBe('loon');
    expect(result.nodes).toHaveLength(1);
  });
});
