/**
 * Frequency-selection engine (GODS-EYE-VIEW-SPEC v2, 4.6).
 *
 * Suggests which ATC facility an aircraft is most likely talking to, from its
 * reported state and the OurAirports airport, runway and frequency tables.
 * The answer is an ESTIMATE: it always carries a confidence and a plain
 * reason, every frequency comes from the dataset, and nothing is hard-coded.
 * OurAirports has no ARTCC (Center) frequencies, so en-route aircraft get a
 * facility with no frequency rather than a guess.
 */

import { bearingDeg, distanceNm } from './store.js';

/** Airports farther than this are never candidates. */
export const CANDIDATE_RADIUS_NM = 60;
const TOWER_RADIUS_NM = 8;
const TOWER_MAX_AGL_FT = 3000;
const TERMINAL_RADIUS_NM = 40;
const EN_ROUTE_MIN_ALT_FT = 18000;
const ALIGN_RADIUS_NM = 10;
const ALIGN_TOLERANCE_DEG = 15;
/** Lined up with a runway only means something on or near the approach. */
const ALIGN_MAX_AGL_FT = 5000;
/** A terminal-area guess this far above the field is a weak one. */
const TERMINAL_WEAK_AGL_FT = 10000;
const CLIMB_FPM = 300;
const DESCENT_FPM = -300;
const STATIONARY_KTS = 2;
const CLEARANCE_STATIONARY_SEC = 120;
const ON_AIRPORT_NM = 3;

export const EN_ROUTE_NOTE = 'En-route (Center) frequency not in dataset';

/** Frequency kinds, matched on the OurAirports type then the description. */
const KIND_MATCHERS = Object.freeze({
  TWR: { types: ['TWR', 'TOWER'], words: /\b(TWR|TOWER)\b/ },
  GND: { types: ['GND', 'GROUND'], words: /\b(GND|GROUND)\b/ },
  CLD: {
    types: ['CLD', 'DEL', 'CLNC', 'CD', 'CLR'],
    words: /\b(CLNC|CLEARANCE|DELIVERY|CLD|DEL)\b/,
  },
  APP: {
    types: ['APP', 'ARR', 'APCH', 'A/D', 'APP/DEP', 'DEP/APP', 'TRACON'],
    words: /\b(APP|APCH|APPROACH|ARR|ARRIVAL|A\/D)\b/,
  },
  DEP: {
    types: ['DEP', 'A/D', 'APP/DEP', 'DEP/APP'],
    words: /\b(DEP|DEPARTURE|A\/D)\b/,
  },
  CTAF: { types: ['CTAF'], words: /\bCTAF\b/ },
  UNICOM: { types: ['UNIC', 'UNICOM'], words: /\bUNICOM\b/ },
  ATIS: { types: ['ATIS', 'D-ATIS'], words: /\bATIS\b/ },
});

const FACILITY_NAMES = Object.freeze({
  TWR: 'Tower',
  GND: 'Ground',
  CLD: 'Clearance Delivery',
  APP: 'Approach',
  DEP: 'Departure',
  CTAF: 'CTAF',
  UNICOM: 'UNICOM',
  ATIS: 'ATIS',
  EN_ROUTE: 'En route (Center)',
});

/**
 * Frequencies of one kind at an airport, in dataset order.
 * @param {{ frequencies: Array<{ type: string|null, description: string|null, mhz: number }> }} airport
 * @param {keyof typeof KIND_MATCHERS} kind
 */
export function frequenciesOfKind(airport, kind) {
  const matcher = KIND_MATCHERS[kind];
  return (airport?.frequencies || []).filter((f) => {
    const type = String(f.type || '').toUpperCase();
    if (matcher.types.includes(type)) return true;
    return matcher.words.test(String(f.description || '').toUpperCase());
  });
}

/** 8-point compass word for a bearing. */
export function compassPoint(deg) {
  const points = [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ];
  return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Smallest angle between two headings, degrees. */
function angleBetween(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

const formatFeet = (ft) => `${Math.round(ft).toLocaleString('en-US')} ft`;
/** 128.45, 119.2, 121.9 — the dataset value, without padding zeros. */
export const formatMhz = (mhz) => String(Number(mhz.toFixed(3)));
const formatNm = (nm) =>
  nm < 10 ? `${nm.toFixed(1)} nm` : `${Math.round(nm)} nm`;

/**
 * The runway end the aircraft is lined up with, if any: within
 * ALIGN_RADIUS_NM of the airport and tracking within ±15° of the end's
 * heading. Also returns the nearest runway for display.
 * @param {any} airport
 * @param {{ lat: number, lon: number, trackDeg: number|null }} aircraft
 */
export function runwayContext(airport, aircraft) {
  let nearest = null;
  let aligned = null;
  for (const runway of airport?.runways || []) {
    for (const end of runway.ends) {
      if (!Number.isFinite(end.lat) || !Number.isFinite(end.lon)) continue;
      const d = distanceNm(aircraft.lat, aircraft.lon, end.lat, end.lon);
      const entry = {
        ident: end.ident,
        headingDegT: end.headingDegT,
        lengthFt: runway.lengthFt,
        surface: runway.surface,
        distanceNm: d,
      };
      if (!nearest || d < nearest.distanceNm) nearest = entry;
      if (
        Number.isFinite(aircraft.trackDeg) &&
        Number.isFinite(end.headingDegT) &&
        angleBetween(aircraft.trackDeg, end.headingDegT) <=
          ALIGN_TOLERANCE_DEG &&
        (!aligned || d < aligned.distanceNm)
      ) {
        aligned = entry;
      }
    }
  }
  const airportDistance = distanceNm(
    aircraft.lat,
    aircraft.lon,
    airport.lat,
    airport.lon,
  );
  return {
    nearest,
    aligned: airportDistance <= ALIGN_RADIUS_NM ? aligned : null,
  };
}

/**
 * @typedef {object} AircraftState
 * @property {number} lat
 * @property {number} lon
 * @property {number|null} altFt Barometric altitude, feet MSL.
 * @property {boolean} onGround
 * @property {number|null} gsKts
 * @property {number|null} trackDeg
 * @property {number|null} vsFpm Vertical rate, feet per minute.
 * @property {number|null} [stationarySec] How long the aircraft has been stopped.
 * @property {string|null} [origin] Plausible-route origin code.
 * @property {string|null} [destination] Plausible-route destination code.
 */

/**
 * Pick the airport the aircraft most plausibly belongs to.
 * @param {ReturnType<typeof import('./store.js').buildAirportStore>} store
 * @param {AircraftState} aircraft
 */
function chooseAirport(store, aircraft) {
  const nearby = store
    .nearest(aircraft.lat, aircraft.lon, {
      radiusNm: CANDIDATE_RADIUS_NM,
      limit: 40,
    })
    .filter(({ airport }) => airport.type !== 'heliport' || aircraft.onGround);
  if (!nearby.length) return null;
  const vs = aircraft.vsFpm;
  const byCode = (code) => {
    if (!code) return null;
    const airport = store.get(code);
    return airport ? nearby.find((c) => c.airport === airport) || null : null;
  };
  const destination = byCode(aircraft.destination);
  if (destination && Number.isFinite(vs) && vs <= DESCENT_FPM) {
    return { ...destination, why: 'route destination, descending' };
  }
  const origin = byCode(aircraft.origin);
  if (
    origin &&
    origin.distanceNm <= 20 &&
    Number.isFinite(vs) &&
    vs >= CLIMB_FPM
  ) {
    return { ...origin, why: 'route origin, climbing' };
  }
  // Nearest airport that publishes any frequency; a private strip with no
  // frequencies cannot tell us who the aircraft is talking to.
  const withFrequencies = nearby.find(
    ({ airport }) => airport.frequencies.length,
  );
  return withFrequencies
    ? { ...withFrequencies, why: 'nearest airport with published frequencies' }
    : { ...nearby[0], why: 'nearest airport' };
}

/**
 * @param {ReturnType<typeof import('./store.js').buildAirportStore>} store
 * @param {AircraftState} aircraft
 */
export function selectFrequency(store, aircraft) {
  const altFt = Number.isFinite(aircraft.altFt) ? aircraft.altFt : null;
  const vs = Number.isFinite(aircraft.vsFpm) ? aircraft.vsFpm : null;
  const trend =
    vs == null
      ? 'level'
      : vs >= CLIMB_FPM
        ? 'climbing'
        : vs <= DESCENT_FPM
          ? 'descending'
          : 'level';

  const cruising =
    !aircraft.onGround && altFt != null && altFt >= EN_ROUTE_MIN_ALT_FT;
  const candidate = chooseAirport(store, aircraft);
  if (!candidate) {
    return enRoute(
      cruising
        ? `At ${formatFeet(altFt)}, above FL180`
        : `No airport within ${CANDIDATE_RADIUS_NM} nm`,
    );
  }
  const { airport, distanceNm: dist } = candidate;
  const code = airport.icao || airport.ident;
  const fromAirport = compassPoint(
    bearingDeg(airport.lat, airport.lon, aircraft.lat, aircraft.lon),
  );
  const where =
    dist < 0.5 ? `at ${code}` : `${formatNm(dist)} ${fromAirport} of ${code}`;
  const agl =
    altFt != null && Number.isFinite(airport.elevationFt)
      ? altFt - airport.elevationFt
      : null;
  const runways = runwayContext(airport, aircraft);
  // Tracking along a runway heading at cruise altitude is coincidence.
  if (!aircraft.onGround && (agl == null || agl >= ALIGN_MAX_AGL_FT)) {
    runways.aligned = null;
  }
  if (cruising) {
    // Above FL180 the aircraft talks to Center. The nearest airport stays in
    // the answer as context (its weather is still useful), with no frequency.
    runways.aligned = null;
  }
  const atis = frequenciesOfKind(airport, 'ATIS').map((f) => ({
    mhz: f.mhz,
    description: f.description,
  }));
  const base = {
    airport: summarizeAirport(airport),
    distanceNm: round(dist, 1),
    altitudeAglFt: agl == null ? null : Math.round(agl),
    runway: runways.nearest,
    alignedRunway: runways.aligned,
    atis,
    estimated: true,
  };

  /** Build a result from the first kind (in order) the airport publishes. */
  const pick = (kinds, confidence, situation, extraReason = '') => {
    for (const [index, kind] of kinds.entries()) {
      const found = frequenciesOfKind(airport, kind);
      if (!found.length) continue;
      const fell = index > 0 ? ` (no ${FACILITY_NAMES[kinds[0]]} listed)` : '';
      const conf = index > 0 ? lower(confidence) : confidence;
      const more =
        found.length > 1
          ? `; ${found.length} ${FACILITY_NAMES[kind]} frequencies listed`
          : '';
      return {
        ...base,
        facility: kind,
        facilityName: FACILITY_NAMES[kind],
        frequencyMHz: found[0].mhz,
        frequencyDescription: found[0].description,
        alternatives: found.slice(1).map((f) => f.mhz),
        confidence: conf,
        reason: `${situation}, ${where}${extraReason} → ${FACILITY_NAMES[kind]} ${formatMhz(found[0].mhz)}${fell}${more} (${conf})`,
      };
    }
    return {
      ...base,
      facility: null,
      facilityName: null,
      frequencyMHz: null,
      frequencyDescription: null,
      alternatives: [],
      confidence: 'LOW',
      reason: `${situation}, ${where} → no ${kinds.map((k) => FACILITY_NAMES[k]).join(' / ')} frequency listed for ${code} (LOW)`,
    };
  };

  if (cruising) {
    return enRoute(`At ${formatFeet(altFt)}, above FL180, ${where}`, base);
  }

  if (aircraft.onGround) {
    const onAirport = dist <= ON_AIRPORT_NM;
    const stopped =
      Number.isFinite(aircraft.gsKts) && aircraft.gsKts < STATIONARY_KTS;
    const longStop =
      stopped && (aircraft.stationarySec ?? 0) > CLEARANCE_STATIONARY_SEC;
    const situation = longStop
      ? 'On the ground, stationary over 2 min'
      : stopped
        ? 'On the ground, stopped'
        : 'On the ground, taxiing';
    const kinds = longStop
      ? ['CLD', 'GND', 'TWR', 'CTAF', 'UNICOM']
      : ['GND', 'TWR', 'CTAF', 'UNICOM'];
    return pick(kinds, onAirport ? 'HIGH' : 'MEDIUM', situation);
  }

  const aglText =
    agl == null ? 'altitude unknown' : `${formatFeet(Math.max(0, agl))} AGL`;
  const trendText =
    trend === 'descending'
      ? 'Descending through'
      : trend === 'climbing'
        ? 'Climbing through'
        : 'Level at';
  const situation =
    agl == null ? `Airborne, ${aglText}` : `${trendText} ${aglText}`;
  const alignedText = runways.aligned
    ? `, aligned with RWY ${runways.aligned.ident}`
    : '';

  if (dist <= TOWER_RADIUS_NM && agl != null && agl < TOWER_MAX_AGL_FT) {
    const confidence = runways.aligned ? 'HIGH' : 'MEDIUM';
    return pick(['TWR', 'CTAF', 'UNICOM'], confidence, situation, alignedText);
  }
  if (dist <= TERMINAL_RADIUS_NM) {
    const trendConfidence =
      agl != null && agl >= TERMINAL_WEAK_AGL_FT ? 'LOW' : 'MEDIUM';
    if (trend === 'descending')
      return pick(['APP'], trendConfidence, situation, alignedText);
    if (trend === 'climbing')
      return pick(['DEP', 'APP'], trendConfidence, situation, alignedText);
    return pick(['APP', 'DEP'], 'LOW', situation, alignedText);
  }
  return enRoute(
    `${situation}, ${formatNm(dist)} ${fromAirport} of ${code}, beyond ${TERMINAL_RADIUS_NM} nm`,
    base,
  );
}

function enRoute(situation, base = {}) {
  return {
    airport: null,
    distanceNm: null,
    altitudeAglFt: null,
    runway: null,
    alignedRunway: null,
    atis: [],
    ...base,
    estimated: true,
    facility: 'EN_ROUTE',
    facilityName: FACILITY_NAMES.EN_ROUTE,
    frequencyMHz: null,
    frequencyDescription: null,
    alternatives: [],
    confidence: 'LOW',
    reason: `${situation} → ${EN_ROUTE_NOTE}`,
    note: EN_ROUTE_NOTE,
  };
}

function lower(confidence) {
  return confidence === 'HIGH' ? 'MEDIUM' : 'LOW';
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function summarizeAirport(airport) {
  return {
    ident: airport.ident,
    icao: airport.icao,
    iata: airport.iata,
    name: airport.name,
    type: airport.type,
    lat: airport.lat,
    lon: airport.lon,
    elevationFt: airport.elevationFt,
    municipality: airport.municipality,
  };
}
