/**
 * Minimal RFC 4180 CSV reader for the OurAirports files: quoted fields,
 * doubled quotes, commas and newlines inside quotes, CRLF or LF endings.
 */

/**
 * Parse CSV text into objects keyed by the header row.
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseCsv(text) {
  const rows = parseRows(text);
  if (!rows.length) return [];
  const header = rows[0];
  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length === 1 && row[0] === '') continue;
    /** @type {Record<string, string>} */
    const record = {};
    for (let c = 0; c < header.length; c += 1) record[header[c]] = row[c] ?? '';
    records.push(record);
  }
  return records;
}

/**
 * Parse CSV text into arrays of fields, header row included. Use this when
 * header names repeat (the AWC METAR file has four `sky_cover` columns).
 * @param {string} text
 * @returns {string[][]}
 */
export function parseRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
