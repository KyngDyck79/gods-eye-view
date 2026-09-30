/** Small text helpers for GOD replies. Pure. */

const CARDINALS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];

/** 229 → "south-west". */
export function cardinal(bearingDeg) {
  const b = Number(bearingDeg);
  if (!Number.isFinite(b)) return '';
  return CARDINALS[Math.round((((b % 360) + 360) % 360) / 45) % 8];
}

/** 8_000 → "8 seconds ago"; 125_000 → "2 minutes ago". */
export function ageText(ms) {
  const s = Math.max(0, Math.round(Number(ms) / 1000));
  if (!Number.isFinite(s)) return 'at an unknown time';
  if (s < 2) return 'just now';
  if (s < 90) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

export const NOT_AVAILABLE =
  'That information is not currently available from the connected data sources.';

export const AI_NOT_CONFIGURED =
  'AI assistant not configured — add an AI key in Settings → AI.';

export const M_TO_FT = 3.28084;
