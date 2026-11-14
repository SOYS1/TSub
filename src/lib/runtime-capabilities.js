import { getSystemCapabilities } from './deployments.js';

let cachedCapabilities = null;

/**
 * Load `/api/system/capabilities` once per page and share it between all
 * operator editors. A failure resolves to `null` so the UI fails open instead
 * of hiding features on a transient network error.
 */
export function loadRuntimeCapabilities() {
  if (!cachedCapabilities) {
    cachedCapabilities = getSystemCapabilities()
      .then(result => result?.data || result || null)
      .catch(() => {
        cachedCapabilities = null;
        return null;
      });
  }
  return cachedCapabilities;
}

/**
 * Resolve which speed-test layers the current deployment can run.
 * - TCP ping is always available.
 * - Real ping / download need a local proxy core (self-hosted controller).
 */
export function resolveSpeedTestSupport(capabilities) {
  if (!capabilities) {
    return { tcpPing: true, realPing: true, download: true };
  }

  const speedTest = capabilities.features?.speedTest;
  if (speedTest && typeof speedTest === 'object') {
    return {
      tcpPing: speedTest.tcpPing !== false,
      realPing: speedTest.realPing === true,
      download: speedTest.download === true
    };
  }

  const isServer = capabilities.platform === 'server';
  return { tcpPing: true, realPing: isServer, download: isServer };
}
