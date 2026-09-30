/**
 * Aviation-friendly phrasing for spoken replies (GODS-EYE-VIEW-SPEC v2, 4.21).
 * Callsigns use airline telephony, altitudes read in words (flight levels
 * optional above the US transition altitude, 18,000 ft), headings as three
 * digits. Pure.
 */

/** ICAO airline designator → radiotelephony callsign (FAA JO 7340.2). */
export const AIRLINE_TELEPHONY = Object.freeze({
  AAL: 'American',
  ABX: 'Abex',
  ACA: 'Air Canada',
  AFR: 'Airfrance',
  AMX: 'Aeromexico',
  ASA: 'Alaska',
  AAY: 'Allegiant',
  BAW: 'Speedbird',
  DAL: 'Delta',
  DLH: 'Lufthansa',
  EDV: 'Endeavor',
  ENY: 'Envoy',
  FDX: 'FedEx',
  FFT: 'Frontier Flight',
  GJS: 'Lindbergh',
  GTI: 'Giant',
  HAL: 'Hawaiian',
  JBU: 'JetBlue',
  JIA: 'Blue Streak',
  KLM: 'KLM',
  MXY: 'Moxy',
  NKS: 'Spirit Wings',
  PDT: 'Piedmont',
  QXE: 'Horizon',
  RPA: 'Brickyard',
  SCX: 'Sun Country',
  SKW: 'SkyWest',
  SWA: 'Southwest',
  UAE: 'Emirates',
  UAL: 'United',
  UPS: 'U P S',
  VIR: 'Virgin',
  WJA: 'WestJet',
});

const DIGITS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

const PHONETIC = Object.freeze({
  A: 'Alfa',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
  L: 'Lima',
  M: 'Mike',
  N: 'November',
  O: 'Oscar',
  P: 'Papa',
  Q: 'Quebec',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  U: 'Uniform',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
});

/** Each character spoken: digits as words, letters phonetically. */
export function spellOut(text) {
  return [...String(text || '').toUpperCase()]
    .map((c) => (/\d/.test(c) ? DIGITS[Number(c)] : PHONETIC[c] || ''))
    .filter(Boolean)
    .join(' ');
}

/** "AAL123" → "American one two three"; "N12345" → "November one two three four five". */
export function speakCallsign(callsign) {
  const cs = String(callsign || '')
    .trim()
    .toUpperCase();
  if (!cs) return 'unknown aircraft';
  const airline = /^([A-Z]{3})(\d[0-9A-Z]*)$/.exec(cs);
  if (airline && AIRLINE_TELEPHONY[airline[1]])
    return `${AIRLINE_TELEPHONY[airline[1]]} ${spellOut(airline[2])}`;
  return spellOut(cs);
}

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

/** 0–999 in words. */
function under1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r >= 20)
    parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''));
  else if (r) parts.push(ONES[r]);
  return parts.join(' ');
}

/** Whole number in words (0–999,999). */
export function numberWords(n) {
  const v = Math.round(Math.abs(Number(n)));
  if (!Number.isFinite(v)) return '';
  if (v === 0) return 'zero';
  const thousands = Math.floor(v / 1000);
  const rest = v % 1000;
  return [
    thousands ? `${under1000(thousands)} thousand` : '',
    rest ? under1000(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export const US_TRANSITION_ALTITUDE_FT = 18_000;

/**
 * @param {number} feet
 * @param {{ flightLevels?: boolean }} [options]
 */
export function speakAltitude(feet, { flightLevels = false } = {}) {
  const ft = Number(feet);
  if (!Number.isFinite(ft)) return 'altitude unknown';
  if (ft < 50) return 'on the ground';
  if (flightLevels && ft >= US_TRANSITION_ALTITUDE_FT)
    return `flight level ${spellOut(String(Math.round(ft / 100)).padStart(3, '0'))}`;
  return `${numberWords(Math.round(ft / 100) * 100)} feet`;
}

/** 90 → "zero nine zero". */
export function speakHeading(degrees) {
  const d = Number(degrees);
  if (!Number.isFinite(d)) return 'heading unknown';
  const h = ((Math.round(d) % 360) + 360) % 360 || 360;
  return spellOut(String(h).padStart(3, '0'));
}

/** 8 → "eight seconds ago"; 125 → "two minutes ago". */
export function speakAge(seconds) {
  const s = Math.max(0, Math.round(Number(seconds)));
  if (!Number.isFinite(s)) return 'at an unknown time';
  if (s < 2) return 'just now';
  if (s < 90) return `${numberWords(s)} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${numberWords(m)} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  return `${numberWords(h)} hour${h === 1 ? '' : 's'} ago`;
}

/**
 * "That's American one two three, a Boeing 737-800, at thirty-four thousand
 * feet, as of eight seconds ago."
 * @param {{ callsign?: string, registration?: string, icao24?: string, typeName?: string|null, altitudeFt?: number|null, ageSec?: number|null }} a
 * @param {{ flightLevels?: boolean }} [options]
 */
export function describeAircraft(a, options = {}) {
  const who = speakCallsign(a.callsign || a.registration || a.icao24);
  const parts = [`That's ${who}`];
  if (a.typeName) parts.push(`a ${a.typeName}`);
  if (Number.isFinite(a.altitudeFt))
    parts.push(`at ${speakAltitude(a.altitudeFt, options)}`);
  let text = parts.join(', ');
  if (Number.isFinite(a.ageSec)) text += `, as of ${speakAge(a.ageSec)}`;
  return `${text}.`;
}
