/**
 * Who may use the owner-only routes (speech, GOD's AI tier): requests made on
 * this Mac, or through Tailscale Serve by a login listed in GEV_OWNER_LOGINS.
 *
 * Tailscale Serve proxies from loopback, so a loopback socket alone proves
 * nothing once Serve is on: it adds Tailscale-User-Login for every tailnet
 * user (including people a device is shared with) and strips that header
 * from incoming requests, so the header names the real requester
 * (https://tailscale.com/kb/1312/serve). Funnel traffic carries no identity
 * and is refused, as is anything else fronted by a proxy.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_SIGNALS = [
  'forwarded',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-real-ip',
  'cf-connecting-ip',
  'cf-ray',
];

/** GEV_OWNER_LOGINS, comma-separated, lower-cased. */
export function ownerLogins(env = process.env) {
  return new Set(
    String(env.GEV_OWNER_LOGINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hostName(hostHeader) {
  const raw = String(hostHeader || '')
    .trim()
    .toLowerCase();
  if (raw.startsWith('[')) return raw.slice(1, raw.indexOf(']'));
  return raw.replace(/:\d+$/, '');
}

/**
 * @param {any} req Node request.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ owner: boolean, via?: 'local'|'tailscale', login?: string, reason?: string }}
 */
export function requestAccess(req, env = process.env) {
  const addr = String(req?.socket?.remoteAddress || '');
  if (!LOOPBACK.has(addr)) return { owner: false, reason: 'remote' };
  const headers = req?.headers || {};
  const login = String(headers['tailscale-user-login'] || '').trim();
  if (login) {
    return ownerLogins(env).has(login.toLowerCase())
      ? { owner: true, via: 'tailscale', login }
      : { owner: false, reason: 'not-owner', login };
  }
  if (PROXY_SIGNALS.some((h) => String(headers[h] || '').trim()))
    return { owner: false, reason: 'proxied' };
  const host = hostName(headers.host);
  if (
    host !== 'localhost' &&
    host !== '127.0.0.1' &&
    host !== '::1' &&
    !host.endsWith('.localhost')
  )
    return { owner: false, reason: 'host' };
  return { owner: true, via: 'local' };
}

export const OWNER_ONLY_MESSAGE =
  'Available only on the Mac running the app, or to the owner’s Tailscale login (GEV_OWNER_LOGINS in .env)';
