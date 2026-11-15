/**
 * Lazy loader for the Surge / Loon / QuantumultX config parsers.
 *
 * These parsers are only needed for explicit "bulk import" / paste flows, but
 * together they are ~1200 lines. Keeping them behind `import()` removes them
 * from the entry chunk and fetches them on first use.
 */

const parserLoaders = {
  surge: () => import('./surge-parser.js').then((module) => module.parseSurgeConfig),
  loon: () => import('./loon-parser.js').then((module) => module.parseLoonConfig),
  quantumultx: () => import('./quantumultx-parser.js').then((module) => module.parseQuantumultXConfig)
};

const parserPromises = new Map();

// Two shapes are accepted by the Surge parser:
//   `Name = ss, server, port, ...`
//   `ss=Name, server, port, ...` (inline protocol key)
// Matching is cheap and lets callers avoid downloading the parser for plain
// share links.
const SURGE_CONFIG_LINE_RE = /^\s*(?:[^=\n]+=\s*(?:ss|ssr|vmess|vless|trojan|hysteria2|hy2|tuic|wireguard|snell|anytls|http-proxy|https-proxy|http|https|socks5)\s*,|(?:ss|ssr|vmess|vless|trojan|hysteria2|hy2|tuic|wireguard|snell|anytls|http-proxy|https-proxy)\s*=)/im;

export function looksLikeSurgeConfig(content) {
  return SURGE_CONFIG_LINE_RE.test(String(content || ''));
}

/**
 * Detect which client config format a pasted blob uses. Mirrors the previous
 * synchronous `parseClientConfig` heuristics so behaviour is unchanged.
 */
export function detectClientConfigType(content) {
  const text = String(content || '');
  const lower = text.toLowerCase();

  if (lower.includes('[server_local]') || lower.includes('shadowsocks=') || lower.includes('vmess=')) {
    return 'quantumultx';
  }

  if (lower.includes('[proxy]') && (
    lower.includes('ss=') ||
    lower.includes('trojan=') ||
    lower.includes('http-proxy') ||
    lower.includes('https-proxy') ||
    lower.includes('private-key=') ||
    lower.includes('peer-public-key=')
  )) {
    return 'surge';
  }

  if (lower.includes('[proxy]') && (
    lower.includes(' = shadowsocks,') ||
    lower.includes(' = vmess,') ||
    lower.includes(' = vless,') ||
    lower.includes(' = trojan,') ||
    lower.includes(' = hysteria2,') ||
    lower.includes(' = tuic,') ||
    lower.includes(' = wireguard,') ||
    lower.includes(' = snell,') ||
    lower.includes(' = anytls,')
  )) {
    return 'loon';
  }

  if (lower.includes('[proxy]') && (
    lower.includes('ss=') ||
    lower.includes('trojan=') ||
    lower.includes('wireguard,') ||
    lower.includes('anytls') ||
    lower.includes('http-proxy') ||
    lower.includes('https-proxy')
  )) {
    return 'surge';
  }

  return 'unknown';
}

/**
 * Resolve a parser function for the given client. Repeated calls share the
 * in-flight module promise, so the chunk is only fetched once.
 */
export function loadClientParser(client) {
  const key = String(client || '').toLowerCase();
  const loader = parserLoaders[key];
  if (!loader) return Promise.resolve(null);

  if (!parserPromises.has(key)) {
    const promise = loader().catch((error) => {
      // Drop the failed promise so a later attempt can retry.
      parserPromises.delete(key);
      console.error(`[protocols] Failed to load ${key} parser`, error);
      return null;
    });
    parserPromises.set(key, promise);
  }

  return parserPromises.get(key);
}

/** Parse a pasted config, loading the matching parser on demand. */
export async function parseClientConfig(content) {
  const text = String(content || '');
  const client = detectClientConfigType(text);
  if (client === 'unknown') return { client, nodes: [] };

  const parser = await loadClientParser(client);
  if (!parser) return { client, nodes: [] };

  try {
    return { client, nodes: parser(text) || [] };
  } catch (error) {
    console.error(`[protocols] Failed to parse ${client} config`, error);
    return { client, nodes: [] };
  }
}

/** Parse a Surge snippet / config, loading the Surge parser on demand. */
export async function parseSurgeConfigAsync(content) {
  const parser = await loadClientParser('surge');
  if (!parser) return [];

  try {
    return parser(String(content || '')) || [];
  } catch (error) {
    console.error('[protocols] Failed to parse Surge config', error);
    return [];
  }
}
