/**
 * Per-provider request budget.
 *
 * Guarantees, by construction rather than by convention:
 *   - at most `perMinute` requests are admitted in ANY trailing 60 s window
 *     (a sliding-window log, not a token bucket, so there is no burst above
 *     the stated rate);
 *   - at most `dailyCredits` credits are admitted per UTC day, and fewer when
 *     the provider reports a lower remaining balance;
 *   - no request is admitted while a Retry-After / backoff window or an open
 *     circuit is in force.
 *
 * Every admission goes through `acquire()`. Callers that skip it are the only
 * way to exceed a budget, so provider modules route upstream calls through
 * `run()`, which also de-duplicates concurrent identical requests.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Error thrown by `run()` when the budget refuses a request. */
export class BudgetRefusedError extends Error {
  /**
   * @param {string} reason
   * @param {number} retryInMs
   */
  constructor(reason, retryInMs) {
    super(`Request budget refused: ${reason}`);
    this.name = 'BudgetRefusedError';
    this.reason = reason;
    this.retryInMs = retryInMs;
  }
}

/** Error thrown by a `run()` task to report an upstream HTTP failure. */
export class UpstreamStatusError extends Error {
  /**
   * @param {number} status
   * @param {{ retryAfterMs?: number|null, message?: string }} [options]
   */
  constructor(status, { retryAfterMs = null, message } = {}) {
    super(message || `Upstream HTTP ${status}`);
    this.name = 'UpstreamStatusError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parse a Retry-After header value (seconds or HTTP date) into milliseconds.
 * @param {string|null|undefined} value
 * @param {number} [now]
 * @returns {number|null}
 */
export function parseRetryAfterMs(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** Epoch ms of the UTC midnight that starts the day containing `ms`. */
function utcDayStart(ms) {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * @typedef {object} BudgetOptions
 * @property {number} perMinute Maximum admissions in any trailing minute.
 * @property {number} [dailyCredits] Maximum credits per UTC day (Infinity if unmetered).
 * @property {number} [failureThreshold] Consecutive failures that open the circuit.
 * @property {number} [circuitOpenMs] How long an open circuit refuses requests.
 * @property {number} [backoffBaseMs] First backoff after a failure.
 * @property {number} [backoffMaxMs] Backoff ceiling.
 * @property {() => number} [now]
 * @property {() => number} [random] Jitter source in [0, 1).
 */

/**
 * Create a request budget.
 * @param {BudgetOptions} options
 */
export function createBudget({
  perMinute,
  dailyCredits = Infinity,
  failureThreshold = 5,
  circuitOpenMs = 5 * MINUTE_MS,
  backoffBaseMs = 2_000,
  backoffMaxMs = 5 * MINUTE_MS,
  now = Date.now,
  random = Math.random,
}) {
  if (!(Number.isInteger(perMinute) && perMinute > 0)) {
    throw new TypeError('perMinute must be a positive integer');
  }
  /** Admission timestamps inside the trailing minute, oldest first. */
  const admitted = [];
  let dayStart = utcDayStart(now());
  let creditsUsed = 0;
  /** Provider-reported remaining credits for the current day, if known. */
  let reportedRemaining = null;
  let blockedUntil = 0;
  let blockReason = null;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;
  let halfOpenProbe = false;
  let lastStatus = null;
  const inFlight = new Map();

  function rollDay(t) {
    const start = utcDayStart(t);
    if (start !== dayStart) {
      dayStart = start;
      creditsUsed = 0;
      reportedRemaining = null;
    }
  }

  function prune(t) {
    while (admitted.length && t - admitted[0] >= MINUTE_MS) admitted.shift();
  }

  function creditsRemaining() {
    const own = dailyCredits - creditsUsed;
    return reportedRemaining == null ? own : Math.min(own, reportedRemaining);
  }

  /**
   * Ask to spend one request costing `cost` credits.
   * @param {number} [cost]
   * @returns {{ ok: boolean, reason?: string, retryInMs?: number }}
   */
  function acquire(cost = 1) {
    const t = now();
    rollDay(t);
    prune(t);
    if (t < circuitOpenUntil) {
      return {
        ok: false,
        reason: 'circuit-open',
        retryInMs: circuitOpenUntil - t,
      };
    }
    if (circuitOpenUntil && halfOpenProbe) {
      // Only one probe may be outstanding while half-open.
      return { ok: false, reason: 'circuit-half-open', retryInMs: 1_000 };
    }
    if (t < blockedUntil) {
      return {
        ok: false,
        reason: blockReason || 'backoff',
        retryInMs: blockedUntil - t,
      };
    }
    if (creditsRemaining() < cost) {
      return {
        ok: false,
        reason: 'daily-budget',
        retryInMs: dayStart + DAY_MS - t,
      };
    }
    if (admitted.length >= perMinute) {
      return {
        ok: false,
        reason: 'rate',
        retryInMs: MINUTE_MS - (t - admitted[0]),
      };
    }
    admitted.push(t);
    creditsUsed += cost;
    if (circuitOpenUntil) halfOpenProbe = true;
    return { ok: true };
  }

  /**
   * Record a successful upstream response.
   * @param {{ remainingCredits?: number|null, status?: number }} [info]
   */
  function recordSuccess({ remainingCredits = null, status = 200 } = {}) {
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
    halfOpenProbe = false;
    blockedUntil = 0;
    blockReason = null;
    lastStatus = status;
    if (Number.isFinite(remainingCredits) && remainingCredits >= 0) {
      reportedRemaining = remainingCredits;
    }
  }

  /**
   * Record an upstream failure. 429 and 5xx back off exponentially with
   * jitter, never shorter than a provider's Retry-After. Other 4xx do not
   * back off: retrying them is pointless but not abusive.
   * @param {{ status?: number|null, retryAfterMs?: number|null }} [info]
   */
  function recordFailure({ status = null, retryAfterMs = null } = {}) {
    const t = now();
    lastStatus = status;
    halfOpenProbe = false;
    const throttled = status === 429;
    const transient = status == null || status >= 500 || throttled;
    if (!transient) return;
    consecutiveFailures += 1;
    const exponential = Math.min(
      backoffMaxMs,
      backoffBaseMs * 2 ** (consecutiveFailures - 1),
    );
    // Full jitter in [50%, 100%] of the exponential delay.
    const jittered = exponential * (0.5 + 0.5 * random());
    const wait = Math.max(
      jittered,
      Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
    );
    blockedUntil = Math.max(blockedUntil, t + wait);
    blockReason = throttled ? 'rate-limited' : 'backoff';
    if (consecutiveFailures >= failureThreshold) {
      circuitOpenUntil = t + circuitOpenMs;
    }
  }

  /**
   * Run `task` under this budget, sharing one in-flight call per `key`.
   * `task` throws `UpstreamStatusError` for HTTP failures; any other throw is
   * treated as a network failure.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} task
   * @param {{ cost?: number }} [options]
   * @returns {Promise<T>}
   */
  function run(key, task, { cost = 1 } = {}) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const decision = acquire(cost);
    if (!decision.ok) {
      return Promise.reject(
        new BudgetRefusedError(decision.reason, decision.retryInMs),
      );
    }
    const promise = (async () => {
      try {
        const result = await task();
        recordSuccess();
        return result;
      } catch (error) {
        if (error?.name === 'AbortError') {
          halfOpenProbe = false;
        } else {
          recordFailure({
            status: error?.status ?? null,
            retryAfterMs: error?.retryAfterMs ?? null,
          });
        }
        throw error;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, promise);
    return promise;
  }

  /** JSON-safe view for diagnostics. */
  function snapshot() {
    const t = now();
    rollDay(t);
    prune(t);
    return {
      perMinute,
      usedLastMinute: admitted.length,
      dailyCredits: Number.isFinite(dailyCredits) ? dailyCredits : null,
      creditsUsedToday: creditsUsed,
      creditsRemaining: Number.isFinite(creditsRemaining())
        ? creditsRemaining()
        : null,
      blockedForMs: Math.max(0, blockedUntil - t),
      blockReason: t < blockedUntil ? blockReason : null,
      circuit:
        t < circuitOpenUntil
          ? 'open'
          : circuitOpenUntil
            ? 'half-open'
            : 'closed',
      consecutiveFailures,
      lastStatus,
      inFlight: inFlight.size,
    };
  }

  return { acquire, recordSuccess, recordFailure, run, snapshot };
}
