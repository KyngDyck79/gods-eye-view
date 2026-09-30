/**
 * ATC audio sources (GODS-EYE-VIEW-SPEC v2, 3 Audio and 4.7).
 *
 * Kinds:
 *   USER SDR      Rod's own receiver on the local network (RTLSDR-Airband →
 *                 Icecast). Played through the gateway relay, so activity can
 *                 be measured and LIVE shown honestly.
 *   USER URL      Any stream URL Rod enters, played directly, at his discretion.
 *   EXTERNAL LINK LiveATC: never embedded, proxied, recorded or re-streamed;
 *                 only a link that opens LiveATC's own page.
 *
 * User entries are kept in this browser only (never synced or sent anywhere).
 * Having a frequency for an airport never implies that audio exists.
 */

import { parseTapAddress } from '../data/tapAddress.js';

export const AUDIO_SOURCES_STORAGE_KEY = 'godsEyeView.v2.atcAudioSources';
export const SOURCE_KINDS = Object.freeze({
  SDR: 'USER SDR',
  URL: 'USER URL',
  EXTERNAL: 'EXTERNAL LINK',
});

/** LiveATC's own search page for an airport (opened in a new tab only). */
export function liveAtcSearchUrl(icao) {
  return `https://www.liveatc.net/search/?icao=${encodeURIComponent(String(icao || '').toUpperCase())}`;
}

/** Whether a stream URL points at the local network (the relay's rule). */
export function isLocalStreamUrl(raw) {
  try {
    const url = new URL(raw);
    const port = url.port
      ? Number(url.port)
      : url.protocol === 'https:'
        ? 443
        : 80;
    return Boolean(parseTapAddress(`${url.hostname}:${port}`));
  } catch {
    return false;
  }
}

/**
 * Validate and normalise a user entry. Throws with a readable message.
 * @param {{ id?: string, label?: string, url?: string, kind?: string, airportIcao?: string, frequencyMHz?: number|string }} entry
 */
export function normalizeUserSource(entry) {
  const label = String(entry?.label || '')
    .trim()
    .slice(0, 60);
  let url;
  try {
    url = new URL(String(entry?.url || '').trim());
  } catch {
    throw new Error(
      'Enter a full stream address, starting with http:// or https://',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Stream address must start with http:// or https://');
  }
  if (url.username || url.password) {
    throw new Error('Remove the user name and password from the address');
  }
  if (/(^|\.)liveatc\.net$/i.test(url.hostname)) {
    throw new Error(
      'LiveATC streams cannot be embedded; use LISTEN ON EXTERNAL SOURCE instead',
    );
  }
  const kind =
    entry?.kind === SOURCE_KINDS.SDR ? SOURCE_KINDS.SDR : SOURCE_KINDS.URL;
  if (kind === SOURCE_KINDS.SDR && !isLocalStreamUrl(url.href)) {
    throw new Error(
      'A USER SDR stream must be on your own network (for example http://192.168.1.20:8000/kmyr)',
    );
  }
  const icao = String(entry?.airportIcao || '')
    .trim()
    .toUpperCase();
  const frequency = Number(entry?.frequencyMHz);
  return {
    id:
      entry?.id ||
      `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: label || url.hostname,
    url: url.href,
    kind,
    airportIcao: /^[A-Z0-9]{3,4}$/.test(icao) ? icao : null,
    frequencyMHz:
      Number.isFinite(frequency) && frequency > 0
        ? Math.round(frequency * 1000) / 1000
        : null,
  };
}

/**
 * Browser-local store of user sources. Storage failures (private mode,
 * blocked site data) leave an empty, working list.
 * @param {{ storage?: Storage|null }} [options]
 */
export function createAudioSourceStore({
  storage = globalThis.localStorage ?? null,
} = {}) {
  const listeners = new Set();
  function read() {
    try {
      const parsed = JSON.parse(
        storage?.getItem(AUDIO_SOURCES_STORAGE_KEY) || '[]',
      );
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((entry) => {
        try {
          return [normalizeUserSource(entry)];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }
  function write(list) {
    try {
      storage?.setItem(AUDIO_SOURCES_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Kept for this page view only.
    }
    for (const listener of listeners) listener(list);
  }
  let sources = read();
  return {
    list: () => sources.slice(),
    add(entry) {
      const source = normalizeUserSource(entry);
      sources = [...sources, source];
      write(sources);
      return source;
    },
    remove(id) {
      sources = sources.filter((s) => s.id !== id);
      write(sources);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * AudioSourceProvider.getSources: ranked sources for what the aircraft is
 * probably listening to. User sources for this airport and frequency first,
 * then this airport, then receivers with no airport set, then LiveATC as an
 * external link. Returns `{ kind, label, url, embeddable, credit, license }`.
 * @param {ReturnType<typeof createAudioSourceStore>} store
 * @param {{ airportIcao?: string|null, facilityType?: string|null, frequencyMHz?: number|null }} query
 */
export function getAudioSources(
  store,
  { airportIcao = null, frequencyMHz = null } = {},
) {
  const icao = airportIcao ? String(airportIcao).toUpperCase() : null;
  const sameFrequency = (s) =>
    Number.isFinite(frequencyMHz) &&
    Number.isFinite(s.frequencyMHz) &&
    Math.abs(s.frequencyMHz - frequencyMHz) < 0.0051;
  const rank = (s) => {
    if (icao && s.airportIcao === icao && sameFrequency(s)) return 0;
    if (icao && s.airportIcao === icao) return 1;
    if (!s.airportIcao && s.kind === SOURCE_KINDS.SDR) return 2;
    if (!s.airportIcao) return 3;
    return 9;
  };
  const user = store
    .list()
    .map((s) => ({ s, r: rank(s) }))
    .filter(({ r }) => r < 9)
    .sort((a, b) => a.r - b.r)
    .map(({ s }) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      url: s.url,
      frequencyMHz: s.frequencyMHz,
      airportIcao: s.airportIcao,
      embeddable: true,
      credit: s.kind === SOURCE_KINDS.SDR ? 'Your receiver' : 'Your stream',
      license: 'Your own source',
    }));
  const external = icao
    ? [
        {
          id: `liveatc-${icao}`,
          kind: SOURCE_KINDS.EXTERNAL,
          label: `LiveATC · ${icao}`,
          url: liveAtcSearchUrl(icao),
          frequencyMHz: null,
          airportIcao: icao,
          embeddable: false,
          credit: 'LiveATC.net',
          license:
            'Personal, non-commercial listening on LiveATC.net; not embedded or redistributed',
        },
      ]
    : [];
  return [...user, ...external];
}

/** The page's shared source list (browser storage when available). */
export const audioSourceStore = createAudioSourceStore();
