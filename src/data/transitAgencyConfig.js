/**
 * Transit agencies added by the owner in `config/transit-agencies.json`
 * (GODS-EYE-VIEW-SPEC v2, "Transit"). The built-in feeds stay in
 * `transitFeeds.js`; this file turns config entries into the same feed shape
 * so the proxy and the layer treat them alike.
 *
 * Keys never live in the config file. An entry names the request header the
 * agency expects (`keyHeader`) and the environment variable that holds the
 * key (`keyEnv`, which must start with TRANSIT_KEY_). The key is attached on
 * the server only; the browser catalog never carries it.
 *
 * Pure: no Node built-ins, so node:test can exercise it directly.
 */

import { TRANSIT_FEED_ID_PATTERN, TRANSIT_MODES } from './transitFeeds.js';

export const TRANSIT_KEY_ENV_PATTERN = /^TRANSIT_KEY_[A-Z0-9_]{1,60}$/;
const HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-_]{0,63}$/;
const FORBIDDEN_HEADERS = new Set([
  'host',
  'cookie',
  'content-length',
  'connection',
  'transfer-encoding',
]);

const text = (v, max = 300) =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;

/**
 * @param {unknown} json Parsed config file.
 * @param {Record<string, string|undefined>} env
 * @param {{ reservedIds?: Iterable<string> }} [options]
 * @returns {{ feeds: object[], problems: string[] }}
 */
export function parseTransitAgencies(
  json,
  env = {},
  { reservedIds = [] } = {},
) {
  const feeds = [];
  const problems = [];
  const agencies = /** @type {any} */ (json)?.agencies;
  if (json == null) return { feeds, problems };
  if (!Array.isArray(agencies)) {
    problems.push('config/transit-agencies.json needs an "agencies" list');
    return { feeds, problems };
  }
  const seen = new Set(reservedIds);
  agencies.forEach((raw, index) => {
    const where = `agency #${index + 1}${text(raw?.id, 64) ? ` (${raw.id})` : ''}`;
    const fail = (why) => problems.push(`${where}: ${why}`);
    if (raw?.enabled === false) return;
    const id = text(raw?.id, 64);
    if (!id || !TRANSIT_FEED_ID_PATTERN.test(id))
      return fail('"id" must be lowercase letters, digits and hyphens');
    if (seen.has(id)) return fail(`"id" ${id} is already used`);
    let url;
    try {
      url = new URL(String(raw.vehiclePositionsUrl || ''));
    } catch {
      return fail('"vehiclePositionsUrl" is not a valid address');
    }
    if (url.protocol !== 'https:')
      return fail('"vehiclePositionsUrl" must start with https://');
    if (url.username || url.password)
      return fail('put keys in keyEnv, not in the address');
    const lat = Number(raw.center?.lat);
    const lon = Number(raw.center?.lon);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180))
      return fail('"center" needs a lat and lon');
    const radius = Number(raw.loadRadiusKm);
    if (!(radius >= 1 && radius <= 1000))
      return fail('"loadRadiusKm" must be between 1 and 1000');
    const name = text(raw.name, 80);
    const license = text(raw.license);
    const attribution = text(raw.attribution);
    if (!name || !license || !attribution)
      return fail('"name", "license" and "attribution" are required');
    const headers = {};
    if (raw.keyHeader != null || raw.keyEnv != null) {
      const header = text(raw.keyHeader, 64);
      const envName = text(raw.keyEnv, 72);
      if (
        !header ||
        !HEADER_PATTERN.test(header) ||
        FORBIDDEN_HEADERS.has(header.toLowerCase())
      )
        return fail('"keyHeader" is not a usable header name');
      if (!envName || !TRANSIT_KEY_ENV_PATTERN.test(envName))
        return fail('"keyEnv" must look like TRANSIT_KEY_AGENCY');
      const key = env[envName];
      if (!key || !String(key).trim())
        return fail(`NEEDS KEY: add ${envName}=your-key to .env`);
      headers[header] = String(key).trim();
    }
    const defaultMode = TRANSIT_MODES.includes(raw.defaultMode)
      ? raw.defaultMode
      : 'bus';
    seen.add(id);
    feeds.push(
      Object.freeze({
        id,
        name,
        operator: text(raw.operator) || name,
        region: text(raw.region, 120) || name,
        center: Object.freeze({ lat, lon }),
        loadRadiusKm: radius,
        url: url.href,
        headers: Object.freeze(headers),
        license,
        licenseUrl: text(raw.licenseUrl, 500) || '',
        attribution,
        defaultEnabled: true,
        configured: true,
        defaultMode,
      }),
    );
  });
  return { feeds, problems };
}
