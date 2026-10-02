/**
 * Decoders for the AviationWeather.gov cache files. The raw report text is
 * always kept next to the decoded values (GODS-EYE-VIEW-SPEC v2, 3 and 4.10).
 */

import { parseRows } from '../airports/csv.js';

/** A METAR older than this is STALE (spec 2.3); it is still shown, with its age. */
export const METAR_STALE_MS = 90 * 60_000;

const num = (value) => {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/\+$/, ''));
  return Number.isFinite(n) ? n : null;
};
const text = (value) => {
  const t = String(value ?? '').trim();
  return t && t !== 'null' ? t : null;
};

/**
 * FAA flight category from ceiling (ft AGL) and visibility (statute miles).
 * LIFR: ceiling < 500 or vis < 1; IFR: < 1,000 or < 3; MVFR: ≤ 3,000 or ≤ 5;
 * otherwise VFR. Unknown when neither value is reported.
 * @param {number|null} ceilingFt
 * @param {number|null} visibilitySm
 * @returns {'VFR'|'MVFR'|'IFR'|'LIFR'|null}
 */
export function flightCategory(ceilingFt, visibilitySm) {
  if (ceilingFt == null && visibilitySm == null) return null;
  const c = ceilingFt ?? Infinity;
  const v = visibilitySm ?? Infinity;
  if (c < 500 || v < 1) return 'LIFR';
  if (c < 1000 || v < 3) return 'IFR';
  if (c <= 3000 || v <= 5) return 'MVFR';
  return 'VFR';
}

/**
 * Ceiling: the lowest broken, overcast or obscured layer, or the vertical
 * visibility into an obscuration.
 * @param {Array<{ cover: string, baseFtAgl: number|null }>} layers
 * @param {number|null} verticalVisibilityFt
 */
export function ceilingFt(layers, verticalVisibilityFt) {
  let ceiling = Number.isFinite(verticalVisibilityFt)
    ? verticalVisibilityFt
    : null;
  for (const layer of layers) {
    if (!['BKN', 'OVC', 'OVX'].includes(layer.cover)) continue;
    if (!Number.isFinite(layer.baseFtAgl)) continue;
    if (ceiling == null || layer.baseFtAgl < ceiling) ceiling = layer.baseFtAgl;
  }
  return ceiling;
}

/**
 * Decode the AWC `metars.cache.csv` file.
 * @param {string} csv
 * @returns {Map<string, any>} Newest report per station, keyed by ICAO id.
 */
export function decodeMetarCsv(csv) {
  const rows = parseRows(csv);
  const header = rows.findIndex((row) => row[0] === 'raw_text');
  if (header < 0) throw new Error('AWC METAR file has no header row');
  const names = rows[header];
  const first = (name) => names.indexOf(name);
  const all = (name) => names.flatMap((n, i) => (n === name ? [i] : []));
  const col = {
    raw: first('raw_text'),
    station: first('station_id'),
    time: first('observation_time'),
    lat: first('latitude'),
    lon: first('longitude'),
    temp: first('temp_c'),
    dew: first('dewpoint_c'),
    wdir: first('wind_dir_degrees'),
    wspd: first('wind_speed_kt'),
    wgst: first('wind_gust_kt'),
    vis: first('visibility_statute_mi'),
    altim: first('altim_in_hg'),
    wx: first('wx_string'),
    category: first('flight_category'),
    vv: first('vert_vis_ft'),
    type: first('metar_type'),
    elev: first('elevation_m'),
  };
  const covers = all('sky_cover');
  const bases = all('cloud_base_ft_agl');
  const byStation = new Map();
  for (const row of rows.slice(header + 1)) {
    const station = text(row[col.station]);
    const raw = text(row[col.raw]);
    const observedAt = Date.parse(row[col.time]);
    if (!station || !raw || !Number.isFinite(observedAt)) continue;
    const layers = covers
      .map((ci, k) => ({ cover: text(row[ci]), baseFtAgl: num(row[bases[k]]) }))
      .filter((layer) => layer.cover);
    const visRaw = text(row[col.vis]);
    const visibilitySm = num(visRaw);
    // Despite its name, AWC's vert_vis_ft column carries hundreds of feet
    // (VV007 → 7); the OVX sky layer carries the same value in feet.
    // Observed in every VV report of the 2026-09-30 cache file.
    const vvHundreds = num(row[col.vv]);
    const vv = vvHundreds == null ? null : vvHundreds * 100;
    const ceiling = ceilingFt(layers, vv);
    const windDirRaw = text(row[col.wdir]);
    // The CSV writes variable wind (VRB05KT) as direction 0; read the report.
    const variableWind = windDirRaw === 'VRB' || /\sVRB\d/.test(raw);
    const computed = flightCategory(ceiling, visibilitySm);
    const reported = text(row[col.category]);
    const metar = {
      station,
      raw,
      type: text(row[col.type]) || 'METAR',
      observedAt,
      lat: num(row[col.lat]),
      lon: num(row[col.lon]),
      elevationM: num(row[col.elev]),
      wind: {
        directionDeg: variableWind ? null : num(windDirRaw),
        variable: variableWind,
        speedKt: num(row[col.wspd]),
        gustKt: num(row[col.wgst]),
      },
      visibilitySm,
      visibilityText: visRaw ? `${visRaw} SM` : null,
      weather: text(row[col.wx]),
      layers,
      verticalVisibilityFt: vv,
      ceilingFt: ceiling,
      temperatureC: num(row[col.temp]),
      dewpointC: num(row[col.dew]),
      altimeterInHg: num(row[col.altim]),
      // AWC's own category when it publishes one; ours from the same fields otherwise.
      flightCategory: ['VFR', 'MVFR', 'IFR', 'LIFR'].includes(reported)
        ? reported
        : computed,
      computedFlightCategory: computed,
    };
    const previous = byStation.get(station);
    if (!previous || previous.observedAt < observedAt)
      byStation.set(station, metar);
  }
  return byStation;
}

/** Plain-English one-liner for a decoded METAR. */
export function describeMetar(metar) {
  const parts = [];
  const w = metar.wind;
  if (w.speedKt === 0) parts.push('Wind calm');
  else if (w.speedKt != null) {
    const dir = w.variable
      ? 'variable'
      : w.directionDeg != null
        ? `${String(w.directionDeg).padStart(3, '0')}°`
        : 'direction unknown';
    parts.push(
      `Wind ${dir} at ${w.speedKt} kt${w.gustKt ? ` gusting ${w.gustKt}` : ''}`,
    );
  }
  if (metar.visibilityText) parts.push(`visibility ${metar.visibilityText}`);
  parts.push(
    metar.ceilingFt != null
      ? `ceiling ${metar.ceilingFt.toLocaleString('en-US')} ft`
      : 'no ceiling',
  );
  if (metar.weather) parts.push(metar.weather);
  if (metar.temperatureC != null)
    parts.push(`temperature ${metar.temperatureC} °C`);
  if (metar.dewpointC != null) parts.push(`dewpoint ${metar.dewpointC} °C`);
  if (metar.altimeterInHg != null)
    parts.push(`altimeter ${metar.altimeterInHg.toFixed(2)} inHg`);
  return parts.join(', ');
}

/** TAF vertical visibility, read with the same hundreds-of-feet unit as METARs. */
const vvFeet = (hundreds) => (hundreds == null ? null : hundreds * 100);

const tag = (xml, name) => {
  const match = xml.match(
    new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`),
  );
  return match ? match[1].trim() : null;
};

/**
 * Decode the AWC `tafs.cache.xml` file (TAF schema 2.0).
 * @param {string} xml
 * @returns {Map<string, any>} Newest TAF per station.
 */
export function decodeTafXml(xml) {
  const byStation = new Map();
  for (const block of xml.split('<TAF>').slice(1)) {
    const body = block.split('</TAF>')[0];
    const station = tag(body, 'station_id');
    const raw = tag(body, 'raw_text');
    const issuedAt = Date.parse(tag(body, 'issue_time') || '');
    if (!station || !raw || !Number.isFinite(issuedAt)) continue;
    const periods = body
      .split('<forecast>')
      .slice(1)
      .map((chunk) => {
        const f = chunk.split('</forecast>')[0];
        const sky = [
          ...f.matchAll(
            /<sky_condition\s+sky_cover="([A-Z]+)"(?:\s+cloud_base_ft_agl="(\d+)")?/g,
          ),
        ].map((m) => ({
          cover: m[1],
          baseFtAgl: m[2] ? Number(m[2]) : null,
        }));
        const vis = tag(f, 'visibility_statute_mi');
        return {
          from: Date.parse(tag(f, 'fcst_time_from') || '') || null,
          to: Date.parse(tag(f, 'fcst_time_to') || '') || null,
          change: tag(f, 'change_indicator') || 'BASE',
          probability: num(tag(f, 'probability')),
          wind: {
            directionDeg: num(tag(f, 'wind_dir_degrees')),
            speedKt: num(tag(f, 'wind_speed_kt')),
            gustKt: num(tag(f, 'wind_gust_kt')),
          },
          visibilitySm: num(vis),
          visibilityText: vis ? `${vis} SM` : null,
          weather: tag(f, 'wx_string'),
          layers: sky,
          ceilingFt: ceilingFt(sky, vvFeet(num(tag(f, 'vert_vis_ft')))),
        };
      })
      .sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
    const taf = {
      station,
      raw,
      issuedAt,
      validFrom: Date.parse(tag(body, 'valid_time_from') || '') || null,
      validTo: Date.parse(tag(body, 'valid_time_to') || '') || null,
      lat: num(tag(body, 'latitude')),
      lon: num(tag(body, 'longitude')),
      periods,
    };
    const previous = byStation.get(station);
    if (!previous || previous.issuedAt < issuedAt) byStation.set(station, taf);
  }
  return byStation;
}
