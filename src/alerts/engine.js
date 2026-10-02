/**
 * Alerts engine (GODS-EYE-VIEW-SPEC v2, 4.17). Pure rule functions turn
 * observations into alerts; the feed de-duplicates them, keeps timestamps,
 * and makes sure no alert is ever read aloud twice.
 *
 * Wording is neutral on purpose: transponder codes are sometimes set in
 * error, so an alert reports what was received and never dramatizes it.
 */

export const ALERT_RULES = Object.freeze({
  squawk: {
    label: 'Emergency squawks (7500 / 7600 / 7700)',
    defaultOn: true,
    defaultVoice: false,
  },
  nws: {
    label: 'NWS Tornado, Severe Thunderstorm and Flash Flood warnings in view',
    defaultOn: true,
    defaultVoice: false,
  },
  quake: {
    label: 'Earthquakes at or above the set magnitude within the set radius',
    defaultOn: true,
    defaultVoice: false,
  },
  providers: {
    label: 'Data provider goes OFFLINE or RATE LIMITED',
    defaultOn: true,
    defaultVoice: false,
  },
});

const SQUAWK_MEANING = Object.freeze({
  7500: 'unlawful interference code',
  7600: 'radio failure code',
  7700: 'general emergency code',
});

export const NWS_ALERT_EVENTS = Object.freeze([
  'Tornado Warning',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
]);

/**
 * Aircraft squawking an emergency code, or with an emergency status.
 * @param {Array<{ icao24: string, callsign?: string|null, registration?: string|null, squawk?: string|null, emergency?: string|null, lat?: number|null, lon?: number|null }>} aircraft
 */
export function squawkAlerts(aircraft) {
  const out = [];
  for (const a of aircraft || []) {
    const code = String(a?.squawk || '').trim();
    const emergency =
      a?.emergency && a.emergency !== 'none' ? a.emergency : null;
    if (!SQUAWK_MEANING[code] && !emergency) continue;
    const who = a.callsign || a.registration || a.icao24;
    const what = SQUAWK_MEANING[code]
      ? `Squawk ${code}`
      : `Emergency status "${emergency}"`;
    out.push({
      id: `squawk:${a.icao24}:${code || emergency}`,
      rule: 'squawk',
      severity: code === '7700' || code === '7500' ? 'high' : 'medium',
      title: `${what} reported by ${who}`,
      detail: SQUAWK_MEANING[code]
        ? `${SQUAWK_MEANING[code]}; codes can be set in error`
        : 'reported by the aircraft; may be set in error',
      speech: `${what.replace(/(\d)/g, ' $1').replace(/\s+/g, ' ').trim()} reported by ${who}.`,
      lat: Number.isFinite(a.lat) ? a.lat : null,
      lon: Number.isFinite(a.lon) ? a.lon : null,
      target: { layer: 'flights', id: a.icao24 },
    });
  }
  return out;
}

/** NWS warnings of the three spec'd kinds. */
export function nwsAlerts(alerts) {
  return (alerts || [])
    .filter((a) => NWS_ALERT_EVENTS.includes(a?.event))
    .map((a) => {
      const center = a.bbox
        ? { lat: (a.bbox[1] + a.bbox[3]) / 2, lon: (a.bbox[0] + a.bbox[2]) / 2 }
        : { lat: null, lon: null };
      return {
        id: `nws:${a.id}`,
        rule: 'nws',
        severity: a.event === 'Tornado Warning' ? 'high' : 'medium',
        title: `${a.event}`,
        detail: [a.areaDesc, a.expires ? `until ${a.expires}` : null]
          .filter(Boolean)
          .join(' · '),
        speech: `National Weather Service ${a.event} for ${String(a.areaDesc || 'this area').split(';')[0]}.`,
        ...center,
        target: null,
      };
    });
}

const toRad = Math.PI / 180;
/** Great-circle distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const a =
    Math.sin(((lat2 - lat1) * toRad) / 2) ** 2 +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(((lon2 - lon1) * toRad) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * USGS features at or above `minMag` within `radiusKm` of `center`.
 * @param {any[]} features USGS GeoJSON features.
 */
export function quakeAlerts(
  features,
  { center, minMag = 4.5, radiusKm = 500 } = /** @type {any} */ ({}),
) {
  const out = [];
  for (const f of features || []) {
    const mag = Number(f?.properties?.mag);
    const [lon, lat] = f?.geometry?.coordinates || [];
    if (
      !Number.isFinite(mag) ||
      mag < minMag ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    )
      continue;
    if (center) {
      const d = distanceKm(center.lat, center.lon, lat, lon);
      if (d > radiusKm) continue;
    }
    out.push({
      id: `quake:${f.id}`,
      rule: 'quake',
      severity: mag >= 6 ? 'high' : 'medium',
      title: `M${mag.toFixed(1)} earthquake · ${f.properties.place || 'location unknown'}`,
      detail: `USGS · ${new Date(f.properties.time).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      speech: `Magnitude ${mag.toFixed(1)} earthquake, ${f.properties.place || ''}.`,
      lat,
      lon,
      target: null,
    });
  }
  return out;
}

/** Providers currently OFFLINE or RATE LIMITED. */
export function providerAlerts(providers) {
  return (providers || [])
    .filter((p) => p?.status === 'OFFLINE' || p?.status === 'RATE_LIMITED')
    .map((p) => ({
      id: `provider:${p.id}:${p.status}`,
      rule: 'providers',
      severity: 'low',
      title: `${p.name} is ${p.status === 'OFFLINE' ? 'offline' : 'rate limited'}`,
      detail: p.message || null,
      speech: `${p.name} is ${p.status === 'OFFLINE' ? 'offline' : 'rate limited'}.`,
      lat: null,
      lon: null,
      target: null,
    }));
}

/**
 * The alert feed: newest first, de-duplicated by id, with the time each was
 * first seen. Alerts that stop being reported are kept (marked cleared) so
 * the history stays readable; each is announced at most once, ever.
 * @param {{ now?: () => number, speak?: (text: string) => void, max?: number }} [options]
 */
export function createAlertFeed({
  now = Date.now,
  speak = () => {},
  max = 60,
} = {}) {
  /** @type {Map<string, any>} */
  const entries = new Map();
  const spoken = new Set();

  /**
   * Replace the active set for the given rules.
   * @param {string[]} rules Rules that were evaluated this round.
   * @param {any[]} alerts
   * @param {Record<string, any>} settings Per-rule `{ on, voice }`, plus other settings.
   */
  function update(rules, alerts, settings) {
    const t = now();
    const active = new Set();
    for (const alert of alerts) {
      if (!settings[alert.rule]?.on) continue;
      active.add(alert.id);
      const existing = entries.get(alert.id);
      if (existing) {
        Object.assign(existing, alert, {
          firstSeenAt: existing.firstSeenAt,
          lastSeenAt: t,
          cleared: false,
        });
      } else {
        entries.set(alert.id, {
          ...alert,
          firstSeenAt: t,
          lastSeenAt: t,
          cleared: false,
        });
        if (settings[alert.rule]?.voice && !spoken.has(alert.id)) {
          spoken.add(alert.id);
          try {
            speak(alert.speech || alert.title);
          } catch {
            // Speech is a courtesy; the feed still shows the alert.
          }
        }
      }
    }
    for (const entry of entries.values()) {
      if (rules.includes(entry.rule) && !active.has(entry.id))
        entry.cleared = true;
    }
    const sorted = [...entries.values()].sort(
      (a, b) => b.firstSeenAt - a.firstSeenAt,
    );
    for (const extra of sorted.slice(max)) entries.delete(extra.id);
  }

  function list() {
    return [...entries.values()].sort(
      (a, b) =>
        Number(a.cleared) - Number(b.cleared) || b.firstSeenAt - a.firstSeenAt,
    );
  }

  function activeCount() {
    let n = 0;
    for (const e of entries.values()) if (!e.cleared) n += 1;
    return n;
  }

  return { update, list, activeCount, hasSpoken: (id) => spoken.has(id) };
}
