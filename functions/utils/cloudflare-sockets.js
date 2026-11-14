/**
 * Cloudflare Workers / Pages TCP sockets bridge.
 *
 * `cloudflare:sockets` is a workerd builtin and MUST be imported statically.
 * This module is only loaded through a dynamic import on the Cloudflare
 * runtime; the Node controller never imports it, so self-hosted deployments
 * do not need to resolve the `cloudflare:` scheme.
 */

import { connect } from 'cloudflare:sockets';

export { connect };
