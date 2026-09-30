/**
 * In-memory airport, runway, frequency and navaid store built from the
 * OurAirports CSV files, with a 1° grid spatial index for nearest queries.
 * Frequencies always come from the dataset; nothing is hard-coded.
 */

import { parseCsv } from './csv.js';

const NM_PER_RAD = 3440.065;
const CELL_DEG = 1;

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * NM_PER_RAD * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial true bearing from point 1 to point 2, degrees [0, 360). */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.cos((lon2 - lon1) * toRad);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const num = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const text = (value) => {
  const t = String(value ?? '').trim();
  return t || null;
};

/** Grid spatial index over points with `lat`/`lon`. */
function createGrid(items) {
  /** @type {Map<string, any[]>} */
  const cells = new Map();
  const cellKey = (latIndex, lonIndex) => `${latIndex}:${lonIndex}`;
  const lonCells = 360 / CELL_DEG;
  for (const item of items) {
    const key = cellKey(
      Math.floor((item.lat + 90) / CELL_DEG),
      Math.floor((item.lon + 180) / CELL_DEG) % lonCells,
    );
    let bucket = cells.get(key);
    if (!bucket) cells.set(key, (bucket = []));
    bucket.push(item);
  }
  /**
   * Items within `radiusNm`, nearest first.
   * @param {number} lat
   * @param {number} lon
   * @param {number} radiusNm
   * @param {(item: any) => boolean} [filter]
   */
  function within(lat, lon, radiusNm, filter) {
    const dLat = radiusNm / 60;
    const cosLat = Math.max(
      0.01,
      Math.cos((Math.min(89, Math.abs(lat)) * Math.PI) / 180),
    );
    const dLon = Math.min(180, radiusNm / (60 * cosLat));
    const latStart = Math.max(0, Math.floor((lat - dLat + 90) / CELL_DEG));
    const latEnd = Math.min(
      180 / CELL_DEG - 1,
      Math.floor((lat + dLat + 90) / CELL_DEG),
    );
    const lonStart = Math.floor((lon - dLon + 180) / CELL_DEG);
    const lonEnd = Math.floor((lon + dLon + 180) / CELL_DEG);
    const seen = new Set();
    const found = [];
    for (let a = latStart; a <= latEnd; a += 1) {
      for (let b = lonStart; b <= lonEnd; b += 1) {
        const wrapped = ((b % lonCells) + lonCells) % lonCells;
        const key = cellKey(a, wrapped);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const item of cells.get(key) || []) {
          if (filter && !filter(item)) continue;
          const d = distanceNm(lat, lon, item.lat, item.lon);
          if (d <= radiusNm) found.push({ item, distanceNm: d });
        }
      }
    }
    return found.sort((x, y) => x.distanceNm - y.distanceNm);
  }
  return { within };
}

/**
 * Build the store from the four CSV texts.
 * @param {{ airports: string, runways?: string, frequencies?: string, navaids?: string }} csv
 * @param {{ loadedAt?: number }} [meta]
 */
export function buildAirportStore(csv, { loadedAt = Date.now() } = {}) {
  const airports = [];
  /** @type {Map<string, any>} */
  const byCode = new Map();
  for (const row of parseCsv(csv.airports)) {
    const lat = num(row.latitude_deg);
    const lon = num(row.longitude_deg);
    const ident = text(row.ident);
    if (!ident || lat == null || lon == null || row.type === 'closed') continue;
    const airport = {
      ident,
      type: text(row.type),
      name: text(row.name),
      lat,
      lon,
      elevationFt: num(row.elevation_ft),
      country: text(row.iso_country),
      region: text(row.iso_region),
      municipality: text(row.municipality),
      scheduledService: row.scheduled_service === 'yes',
      icao: text(row.icao_code),
      iata: text(row.iata_code),
      gps: text(row.gps_code),
      local: text(row.local_code),
      runways: [],
      frequencies: [],
    };
    airports.push(airport);
    for (const code of [
      airport.ident,
      airport.icao,
      airport.iata,
      airport.gps,
      airport.local,
    ]) {
      if (!code) continue;
      const upper = code.toUpperCase();
      // ICAO/ident outrank IATA/local codes that can collide across countries.
      if (!byCode.has(upper)) byCode.set(upper, airport);
    }
  }
  const byIdent = new Map(airports.map((a) => [a.ident, a]));

  for (const row of csv.runways ? parseCsv(csv.runways) : []) {
    const airport = byIdent.get(text(row.airport_ident));
    if (!airport || row.closed === '1') continue;
    airport.runways.push({
      lengthFt: num(row.length_ft),
      widthFt: num(row.width_ft),
      surface: text(row.surface),
      lighted: row.lighted === '1',
      ends: [
        {
          ident: text(row.le_ident),
          lat: num(row.le_latitude_deg),
          lon: num(row.le_longitude_deg),
          elevationFt: num(row.le_elevation_ft),
          headingDegT: num(row.le_heading_degT),
        },
        {
          ident: text(row.he_ident),
          lat: num(row.he_latitude_deg),
          lon: num(row.he_longitude_deg),
          elevationFt: num(row.he_elevation_ft),
          headingDegT: num(row.he_heading_degT),
        },
      ],
    });
  }

  for (const row of csv.frequencies ? parseCsv(csv.frequencies) : []) {
    const airport = byIdent.get(text(row.airport_ident));
    const mhz = num(row.frequency_mhz);
    if (!airport || mhz == null) continue;
    airport.frequencies.push({
      type: text(row.type),
      description: text(row.description),
      mhz,
    });
  }

  const navaids = [];
  for (const row of csv.navaids ? parseCsv(csv.navaids) : []) {
    const lat = num(row.latitude_deg);
    const lon = num(row.longitude_deg);
    if (lat == null || lon == null) continue;
    navaids.push({
      ident: text(row.ident),
      name: text(row.name),
      type: text(row.type),
      frequencyKhz: num(row.frequency_khz),
      lat,
      lon,
      country: text(row.iso_country),
      associatedAirport: text(row.associated_airport),
    });
  }

  const airportGrid = createGrid(airports);
  const navaidGrid = createGrid(navaids);

  /** Look up an airport by ident, ICAO, IATA, GPS or local code. */
  function get(code) {
    return (
      byCode.get(
        String(code || '')
          .trim()
          .toUpperCase(),
      ) || null
    );
  }

  /**
   * Nearest airports to a point.
   * @param {number} lat
   * @param {number} lon
   * @param {{ radiusNm?: number, limit?: number, types?: string[] }} [options]
   */
  function nearest(lat, lon, { radiusNm = 60, limit = 10, types } = {}) {
    const typeSet = types?.length ? new Set(types) : null;
    return airportGrid
      .within(
        lat,
        lon,
        radiusNm,
        typeSet ? (a) => typeSet.has(a.type) : undefined,
      )
      .slice(0, limit)
      .map(({ item, distanceNm: d }) => ({
        airport: item,
        distanceNm: d,
        bearingDeg: bearingDeg(lat, lon, item.lat, item.lon),
      }));
  }

  /** Navaids near a point. */
  function nearestNavaids(lat, lon, { radiusNm = 40, limit = 10 } = {}) {
    return navaidGrid
      .within(lat, lon, radiusNm)
      .slice(0, limit)
      .map(({ item, distanceNm: d }) => ({ navaid: item, distanceNm: d }));
  }

  /**
   * Search by code or name. Exact code matches first, then name/city prefix,
   * then substring; larger airports rank above small ones.
   * @param {string} query
   * @param {{ limit?: number }} [options]
   */
  function search(query, { limit = 10 } = {}) {
    const q = String(query || '')
      .trim()
      .toUpperCase();
    if (q.length < 2) return [];
    const typeRank = {
      large_airport: 0,
      medium_airport: 1,
      small_airport: 2,
      seaplane_base: 3,
      heliport: 4,
      balloonport: 5,
    };
    const exact = get(q);
    const scored = [];
    for (const airport of airports) {
      if (airport === exact) continue;
      const name = (airport.name || '').toUpperCase();
      const city = (airport.municipality || '').toUpperCase();
      let score;
      if (name.startsWith(q) || city.startsWith(q)) score = 1;
      else if (name.includes(q) || city.includes(q)) score = 2;
      else continue;
      scored.push({
        airport,
        score: score * 10 + (typeRank[airport.type] ?? 6),
      });
    }
    scored.sort((a, b) => a.score - b.score);
    const results = scored.slice(0, limit).map((s) => s.airport);
    return exact ? [exact, ...results].slice(0, limit) : results;
  }

  return {
    loadedAt,
    counts: { airports: airports.length, navaids: navaids.length },
    get,
    nearest,
    nearestNavaids,
    search,
  };
}

/** Public, JSON-safe view of an airport (with or without detail lists). */
export function airportSummary(airport, { detail = false } = {}) {
  if (!airport) return null;
  const { runways, frequencies, ...rest } = airport;
  return detail
    ? { ...rest, runways, frequencies }
    : {
        ...rest,
        runwayCount: runways.length,
        frequencyCount: frequencies.length,
      };
}
