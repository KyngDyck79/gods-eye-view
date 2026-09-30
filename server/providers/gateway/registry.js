/**
 * Provider registry: static metadata (what a provider is, what it costs,
 * whose terms apply) plus live status (did it work, how recently, how much
 * budget is left). Diagnostics, attribution and the usage-mode switch read
 * this one place instead of each proxy inventing its own status line.
 */

/** @typedef {'ONLINE'|'DEGRADED'|'RATE_LIMITED'|'OFFLINE'|'NEEDS_KEY'|'DISABLED'|'IDLE'} ProviderStatus */

/**
 * @typedef {object} ProviderMeta
 * @property {string} id
 * @property {string} name
 * @property {string} domain
 * @property {string} sourceUrl Official documentation link.
 * @property {string} cost
 * @property {boolean} apiKeyRequired
 * @property {string} rateLimit
 * @property {string} license
 * @property {'allowed'|'not-allowed'|'conditional'|'unknown'} commercialUse
 * @property {string} updateFrequency
 * @property {string[]} dataTypes
 * @property {{ text: string, url: string, required: boolean }} [attribution]
 * @property {string} [verified] ISO date the metadata was checked against the docs.
 */

export const USAGE_MODES = Object.freeze(['personal', 'commercial']);

export const COMMERCIAL_DISABLED_MESSAGE =
  'Disabled in commercial mode — provider terms.';

/** A success older than this no longer counts as ONLINE on its own. */
const ONLINE_WINDOW_MS = 10 * 60_000;

/**
 * Read GEV_USAGE_MODE; anything unrecognised is the safe default, personal.
 * @param {Record<string, string|undefined>} [env]
 * @returns {'personal'|'commercial'}
 */
export function readUsageMode(env = process.env) {
  const value = String(env.GEV_USAGE_MODE || '')
    .trim()
    .toLowerCase();
  return value === 'commercial' ? 'commercial' : 'personal';
}

/** Public home of this build, sent where providers ask who is calling. */
export const GEV_PROJECT_URL = 'https://github.com/KyngDyck79/gods-eye-view';

/**
 * Descriptive User-Agent for providers that ask for one (NOAA, AWC,
 * Nominatim, CelesTrak, Overpass, adsb.lol). The contact comes from
 * GEV_CONTACT_EMAIL when set; otherwise the project URL identifies the app.
 * Read at call time: the dev server loads .env after modules are imported.
 * @param {Record<string, string|undefined>} [env]
 */
export function gevUserAgent(env = process.env) {
  const contact = String(env.GEV_CONTACT_EMAIL || '').trim();
  return contact
    ? `GodsEyeView/2.0 (+contact: ${contact})`
    : `GodsEyeView/2.0 (+${GEV_PROJECT_URL})`;
}

/**
 * @param {{ now?: () => number, env?: Record<string, string|undefined> }} [options]
 */
export function createProviderRegistry({
  now = Date.now,
  env = process.env,
} = {}) {
  /** @type {Map<string, any>} */
  const entries = new Map();

  /**
   * @param {ProviderMeta} meta
   * @param {{
   *   budget?: { snapshot: () => any },
   *   configured?: () => boolean,
   *   enabled?: () => boolean,
   * }} [hooks]
   */
  function register(meta, { budget, configured, enabled } = {}) {
    if (!meta?.id) throw new TypeError('Provider metadata needs an id');
    if (entries.has(meta.id)) return entries.get(meta.id).api;
    const entry = {
      meta: Object.freeze({ ...meta }),
      budget: budget || null,
      configured: configured || (() => !meta.apiKeyRequired),
      enabled: enabled || (() => true),
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      lastLatencyMs: null,
      lastObservedAt: null,
      servingStale: false,
    };
    entry.api = {
      id: meta.id,
      /** Whether requests to this provider may be made at all right now. */
      allowed: () => allowed(meta.id),
      /** @param {{ latencyMs?: number, observedAt?: number|null }} [info] */
      success(info = {}) {
        entry.lastSuccessAt = now();
        entry.lastLatencyMs = finiteOrNull(info.latencyMs);
        entry.lastObservedAt = finiteOrNull(info.observedAt);
        entry.servingStale = false;
      },
      /** @param {unknown} error */
      failure(error) {
        entry.lastErrorAt = now();
        entry.lastError = describeError(error);
      },
      /** The route answered with cached data after an upstream failure. */
      stale() {
        entry.servingStale = true;
      },
    };
    entries.set(meta.id, entry);
    return entry.api;
  }

  function usageMode() {
    return readUsageMode(env);
  }

  function blockedByUsageMode(entry) {
    return (
      usageMode() === 'commercial' && entry.meta.commercialUse === 'not-allowed'
    );
  }

  /** @param {string} id */
  function allowed(id) {
    const entry = entries.get(id);
    if (!entry) return false;
    return entry.enabled() && !blockedByUsageMode(entry) && entry.configured();
  }

  /**
   * @param {any} entry
   * @returns {{ status: ProviderStatus, message: string|null }}
   */
  function statusOf(entry) {
    if (!entry.enabled()) return { status: 'DISABLED', message: 'Disabled.' };
    if (blockedByUsageMode(entry)) {
      return { status: 'DISABLED', message: COMMERCIAL_DISABLED_MESSAGE };
    }
    if (!entry.configured()) {
      return {
        status: 'NEEDS_KEY',
        message:
          entry.meta.needsKeyMessage ||
          `${entry.meta.name.toUpperCase()} NEEDS API KEY`,
      };
    }
    const budget = entry.budget?.snapshot?.() || null;
    if (
      budget?.blockReason === 'rate-limited' ||
      budget?.creditsRemaining === 0
    ) {
      return {
        status: 'RATE_LIMITED',
        message: 'Provider rate limit reached.',
      };
    }
    if (budget?.circuit === 'open') {
      return { status: 'OFFLINE', message: entry.lastError };
    }
    const t = now();
    const recentSuccess =
      entry.lastSuccessAt != null && t - entry.lastSuccessAt < ONLINE_WINDOW_MS;
    const failedLast =
      entry.lastErrorAt != null &&
      (entry.lastSuccessAt == null || entry.lastErrorAt > entry.lastSuccessAt);
    if (failedLast) {
      return recentSuccess || entry.servingStale
        ? { status: 'DEGRADED', message: entry.lastError }
        : { status: 'OFFLINE', message: entry.lastError };
    }
    if (entry.lastSuccessAt != null) {
      return recentSuccess
        ? { status: 'ONLINE', message: null }
        : { status: 'IDLE', message: 'Not requested recently.' };
    }
    return { status: 'IDLE', message: 'Not requested yet.' };
  }

  /** JSON-safe list for /api/providers. Never includes keys or secrets. */
  function list() {
    return [...entries.values()].map((entry) => {
      const { status, message } = statusOf(entry);
      return {
        ...entry.meta,
        status,
        message,
        lastSuccessAt: entry.lastSuccessAt,
        lastErrorAt: entry.lastErrorAt,
        lastError: entry.lastError,
        latencyMs: entry.lastLatencyMs,
        lastObservedAt: entry.lastObservedAt,
        budget: entry.budget?.snapshot?.() || null,
      };
    });
  }

  /** @param {string} id */
  function get(id) {
    return entries.get(id)?.api || null;
  }

  return { register, get, list, allowed, usageMode };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/** Short, secret-free description of a failure for diagnostics. */
function describeError(error) {
  if (error == null) return 'Unknown error';
  if (typeof error === 'string') return error.slice(0, 200);
  const status = /** @type {any} */ (error).status;
  if (Number.isFinite(status)) return `HTTP ${status}`;
  const name = /** @type {any} */ (error).name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'Timed out';
  if (name === 'BudgetRefusedError') {
    return `Budget: ${/** @type {any} */ (error).reason}`;
  }
  return 'Network error';
}

/** The gateway's process-wide registry. */
export const providerRegistry = createProviderRegistry();
