/**
 * GET /api/audio/relay?url=… — pass a stream from Rod's OWN receiver on the
 * local network (e.g. RTLSDR-Airband → Icecast) to his browser, same-origin,
 * so the app can measure real stream activity for the LIVE indicator.
 *
 * Deliberately narrow (GODS-EYE-VIEW-SPEC v2, Part 0.7 and 3 Audio):
 *   - only loopback / RFC1918 / localhost / *.local hosts (the shared tap
 *     address rule), names resolved and the socket pinned to those addresses;
 *   - no redirects, no credentials in the URL;
 *   - only audio content types, so it cannot serve as a general LAN proxy;
 *   - nothing is recorded or cached, and no CORS headers are sent, so other
 *     sites cannot read the stream through this route;
 *   - at most MAX_RELAYS streams at once.
 * Public streams (LiveATC and the like) are never relayed.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isLocalIpv4, parseTapAddress } from '../../../src/data/tapAddress.js';
import { resolveLocalReceiverAddresses } from '../local-receivers.js';

export const MAX_RELAYS = 2;
const CONNECT_TIMEOUT_MS = 8_000;
const AUDIO_TYPE = /^(audio\/[a-z0-9.+-]+|application\/ogg)\b/i;

/**
 * Validate a user-supplied stream URL against the local-network rule.
 * @param {string} raw
 * @returns {{ ok: boolean, url?: URL, reason?: string }}
 */
export function validateLocalStreamUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme must be http or https' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials are not allowed in the URL' };
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80;
  if (!parseTapAddress(`${url.hostname}:${port}`)) {
    return {
      ok: false,
      reason: 'only streams on your own network can be relayed',
    };
  }
  return { ok: true, url };
}

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (options?.all)
      done(
        null,
        addresses.map((row) => ({ ...row })),
      );
    else done(null, addresses[0].address, addresses[0].family);
  };
}

/**
 * @param {{ lookupImpl?: typeof dnsLookup, request?: (url: URL, options: object, onResponse: (res: http.IncomingMessage) => void) => http.ClientRequest }} [options]
 */
export function createAudioRelay({
  lookupImpl = dnsLookup,
  request = (url, options, onResponse) =>
    (url.protocol === 'https:' ? https : http).request(
      url,
      options,
      onResponse,
    ),
} = {}) {
  let active = 0;

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async function handle(req, res) {
    const fail = (status, error) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ error }));
    };
    if (req.method !== 'GET') return fail(405, 'GET only');
    const params = new URL(req.url || '', 'http://localhost').searchParams;
    const checked = validateLocalStreamUrl(params.get('url'));
    if (!checked.ok) return fail(400, checked.reason);
    if (active >= MAX_RELAYS)
      return fail(429, 'Too many audio streams at once');
    const { url } = checked;
    let lookup;
    try {
      lookup = isLocalIpv4(url.hostname)
        ? undefined
        : pinnedLookup(
            await resolveLocalReceiverAddresses(url.hostname, lookupImpl),
          );
    } catch {
      return fail(502, 'AUDIO SOURCE UNAVAILABLE');
    }
    active += 1;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active -= 1;
      }
    };
    const upstreamRequest = request(
      url,
      {
        method: 'GET',
        headers: {
          'Icy-MetaData': '0',
          'User-Agent': 'GodsEyeView/2.0 audio relay',
        },
        ...(lookup ? { lookup } : {}),
        agent: false,
        timeout: CONNECT_TIMEOUT_MS,
      },
      (upstream) => {
        const status = upstream.statusCode || 0;
        const type = String(upstream.headers['content-type'] || '');
        if (status !== 200 || !AUDIO_TYPE.test(type)) {
          upstream.destroy();
          release();
          return fail(
            502,
            status >= 300 && status < 400
              ? 'Redirects are not followed'
              : 'AUDIO SOURCE UNAVAILABLE',
          );
        }
        res.writeHead(200, {
          'Content-Type': type.split(';')[0],
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        upstream.pipe(res);
        upstream.on('error', () => res.destroy());
        upstream.on('close', release);
      },
    );
    upstreamRequest.on('timeout', () =>
      upstreamRequest.destroy(new Error('timeout')),
    );
    upstreamRequest.on('error', () => {
      release();
      fail(502, 'AUDIO SOURCE UNAVAILABLE');
    });
    // The listener stopped: stop reading from the receiver too.
    res.on('close', () => {
      upstreamRequest.destroy();
      release();
    });
    upstreamRequest.end();
  }

  return { handle, activeCount: () => active };
}

/** Vite plugin: mount /api/audio/relay on dev and preview servers. */
export function audioRelayProxy(options) {
  let relay = null;
  const install = (server) => {
    relay ||= createAudioRelay(options);
    server.middlewares.use('/api/audio/relay', (req, res) => {
      void relay.handle(req, res);
    });
  };
  return {
    name: 'gev-audio-relay',
    configureServer: install,
    configurePreviewServer: install,
  };
}
