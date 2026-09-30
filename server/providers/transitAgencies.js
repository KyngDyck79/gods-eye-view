/**
 * Reads `config/transit-agencies.json` once at startup and adds the agencies
 * to the transit registry on the server, with their key header filled in from
 * `.env`. Problems (a missing key, a bad address) are logged and reported by
 * `/api/transit/feeds` so the app can show them; they never stop the server.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTransitAgencies } from '../../src/data/transitAgencyConfig.js';
import {
  TRANSIT_FEED_REGISTRY,
  addConfiguredTransitFeeds,
} from '../../src/data/transitFeeds.js';

export const TRANSIT_AGENCIES_FILE = 'config/transit-agencies.json';

let loaded = null;

/**
 * @param {{ root?: string, env?: Record<string, string|undefined>, readFile?: (path: string) => string }} [options]
 * @returns {{ added: number, problems: string[] }}
 */
export function loadTransitAgencies({
  root = process.cwd(),
  env = process.env,
  readFile = (path) => readFileSync(path, 'utf8'),
} = {}) {
  if (loaded) return loaded;
  let json = null;
  const problems = [];
  try {
    json = JSON.parse(readFile(resolve(root, TRANSIT_AGENCIES_FILE)));
  } catch (error) {
    if (error?.code !== 'ENOENT')
      problems.push(
        `${TRANSIT_AGENCIES_FILE} could not be read: ${error.message}`,
      );
  }
  const parsed = parseTransitAgencies(json, env, {
    reservedIds: TRANSIT_FEED_REGISTRY.map((feed) => feed.id),
  });
  problems.push(...parsed.problems);
  const added = addConfiguredTransitFeeds(parsed.feeds);
  for (const problem of problems) console.warn(`[transit] ${problem}`);
  if (added) console.log(`[transit] ${added} agency feed(s) added from config`);
  loaded = { added, problems };
  return loaded;
}
