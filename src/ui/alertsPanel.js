/**
 * ALERTS chip and feed (GODS-EYE-VIEW-SPEC v2, 4.17). Runs the alert rules
 * every 20 s (slower in a hidden tab), shows a timestamped, de-duplicated
 * list, flies the map to an alert on click, and reads new alerts aloud only
 * for rules whose voice switch is on — never the same alert twice.
 */

import {
  ALERT_RULES,
  createAlertFeed,
  nwsAlerts,
  providerAlerts,
  quakeAlerts,
  squawkAlerts,
} from '../alerts/engine.js';

export const ALERT_SETTINGS_KEY = 'godsEyeView.v2.alertRules';

/** Active alerts from the most recent run, for GOD's context. */
let activeAlertsSnapshot = [];
export function getActiveAlerts() {
  return activeAlertsSnapshot;
}
const RUN_MS = 20_000;
const HIDDEN_RUN_MS = 60_000;

/** Stored rule settings merged over the defaults. */
export function readAlertSettings(storage = globalThis.localStorage) {
  let stored = {};
  try {
    stored = JSON.parse(storage?.getItem(ALERT_SETTINGS_KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  const settings = {};
  for (const [id, rule] of Object.entries(ALERT_RULES)) {
    settings[id] = {
      on: typeof stored[id]?.on === 'boolean' ? stored[id].on : rule.defaultOn,
      voice:
        typeof stored[id]?.voice === 'boolean'
          ? stored[id].voice
          : rule.defaultVoice,
    };
  }
  const n = (v, d, min, max) =>
    Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d;
  settings.quakeMinMag = n(stored.quakeMinMag, 4.5, 1, 9);
  settings.quakeRadiusKm = n(stored.quakeRadiusKm, 500, 10, 20000);
  return settings;
}

function writeAlertSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(ALERT_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Kept for this page only.
  }
}

/**
 * @param {{ documentRef?: Document, viewer?: any, dataManager?: any, fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 */
export function initAlertsPanel({
  documentRef = globalThis.document,
  viewer = null,
  dataManager = null,
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  signal,
} = {}) {
  const chip = documentRef?.getElementById?.('alerts-chip');
  const root = documentRef?.getElementById?.('alerts-panel');
  if (!chip || !root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const list = root.querySelector('[data-alerts-list]');
  const rulesHost = root.querySelector('[data-alerts-rules]');
  const label = chip.querySelector('[data-alerts-label]') || chip;
  const closeButton = root.querySelector('[data-alerts-close]');
  const win = documentRef.defaultView || globalThis;
  const lifetime = new AbortController();
  let settings = readAlertSettings();
  let timer = null;
  let disposed = false;
  let lastRunError = null;

  const speak = (text) => {
    const synth = win.speechSynthesis;
    if (!synth || typeof win.SpeechSynthesisUtterance !== 'function') return;
    synth.speak(new win.SpeechSynthesisUtterance(text));
  };
  const feed = createAlertFeed({ speak });

  const el = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function viewCenterAndBox() {
    try {
      const r = viewer?.camera?.computeViewRectangle?.();
      const c = viewer?.camera?.positionCartographic;
      const deg = (x) => (x * 180) / Math.PI;
      return {
        box: r
          ? {
              lamin: deg(r.south),
              lomin: deg(r.west),
              lamax: deg(r.north),
              lomax: deg(r.east),
            }
          : null,
        center: c ? { lat: deg(c.latitude), lon: deg(c.longitude) } : null,
      };
    } catch {
      return { box: null, center: null };
    }
  }

  async function json(url) {
    const response = await fetchImpl(url, {
      signal: lifetime.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function run() {
    if (disposed) return;
    const evaluated = [];
    const alerts = [];
    const { box, center } = viewCenterAndBox();
    const tasks = [];
    if (settings.squawk.on) {
      const flights = dataManager?.layers?.get?.('flights')?.module;
      const records = flights?.getAnalystRecords?.(5000) || [];
      evaluated.push('squawk');
      alerts.push(
        ...squawkAlerts(records.map((r) => ({ ...r, lat: r.lat, lon: r.lon }))),
      );
    }
    if (
      settings.nws.on &&
      box &&
      box.lamin < box.lamax &&
      box.lomin < box.lomax
    ) {
      const q = new URLSearchParams(
        Object.entries(box).map(([k, v]) => [k, v.toFixed(3)]),
      );
      tasks.push(
        json(`/api/nws/alerts?${q}`).then((body) => {
          evaluated.push('nws');
          alerts.push(...nwsAlerts(body.alerts));
        }),
      );
    }
    if (settings.quake.on) {
      tasks.push(
        json('/api/usgs/2.5_day').then((body) => {
          evaluated.push('quake');
          alerts.push(
            ...quakeAlerts(body.features, {
              center,
              minMag: settings.quakeMinMag,
              radiusKm: settings.quakeRadiusKm,
            }),
          );
        }),
      );
    }
    if (settings.providers.on) {
      tasks.push(
        json('/api/providers').then((body) => {
          evaluated.push('providers');
          alerts.push(...providerAlerts(body.providers));
        }),
      );
    }
    const results = await Promise.allSettled(tasks);
    if (disposed) return;
    lastRunError = results.some((r) => r.status === 'rejected')
      ? 'Some alert sources could not be checked'
      : null;
    feed.update(evaluated, alerts, settings);
    activeAlertsSnapshot = feed
      .list()
      .filter((a) => !a.cleared)
      .map(({ title, detail, firstSeenAt }) => ({
        title,
        detail,
        firstSeenAt,
      }));
    render();
  }

  function schedule() {
    clearTimeout(timer);
    if (disposed) return;
    timer = setTimeout(
      async () => {
        await run();
        schedule();
      },
      documentRef.visibilityState === 'hidden' ? HIDDEN_RUN_MS : RUN_MS,
    );
  }

  function flyTo(alert) {
    if (alert.target?.layer === 'flights') {
      const flights = dataManager?.layers?.get?.('flights')?.module;
      if (flights?.trackById?.(alert.target.id, { origin: 'user' })) return;
    }
    if (!Number.isFinite(alert.lat) || !Number.isFinite(alert.lon)) return;
    const Cartesian3 = viewer?.scene?.globe?.ellipsoid;
    if (!viewer?.camera || !Cartesian3) return;
    const deg = Math.PI / 180;
    viewer.camera.flyTo({
      destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: alert.lon * deg,
        latitude: alert.lat * deg,
        height: 80_000,
      }),
      duration: 2,
    });
  }

  function render() {
    const count = feed.activeCount();
    chip.dataset.count = String(count);
    label.textContent = count ? `ALERTS · ${count}` : 'ALERTS';
    chip.title = count
      ? `${count} active alert${count === 1 ? '' : 's'}`
      : 'No active alerts';
    if (!list || root.hidden) return;
    list.textContent = '';
    const entries = feed.list();
    if (lastRunError)
      list.append(el('p', 'system-status-message', lastRunError));
    if (!entries.length) {
      list.append(
        el(
          'p',
          'system-status-detail',
          'No alerts. Rules run every 20 seconds for the current view.',
        ),
      );
      return;
    }
    for (const alert of entries) {
      const row = el(
        'button',
        `alerts-row alerts-${alert.severity}${alert.cleared ? ' alerts-cleared' : ''}`,
      );
      row.type = 'button';
      const time = new Date(alert.firstSeenAt).toISOString().slice(11, 16);
      row.append(
        el(
          'span',
          'alerts-time',
          `${time}Z${alert.cleared ? ' · cleared' : ''}`,
        ),
        el('strong', 'alerts-title', alert.title),
        el('span', 'alerts-detail', alert.detail || ''),
      );
      row.addEventListener('click', () => flyTo(alert));
      list.append(row);
    }
  }

  function renderRules() {
    if (!rulesHost) return;
    rulesHost.textContent = '';
    for (const [id, rule] of Object.entries(ALERT_RULES)) {
      const row = el('div', 'alerts-rule');
      row.append(el('span', 'alerts-rule-label', rule.label));
      for (const key of ['on', 'voice']) {
        const toggle = el('label', 'alerts-toggle');
        const box = /** @type {HTMLInputElement} */ (el('input'));
        box.type = 'checkbox';
        box.checked = settings[id][key];
        box.addEventListener('change', () => {
          settings[id][key] = box.checked;
          writeAlertSettings(settings);
          void run();
        });
        toggle.append(
          box,
          documentRef.createTextNode(key === 'on' ? ' ON' : ' VOICE'),
        );
        row.append(toggle);
      }
      rulesHost.append(row);
    }
    const quake = el('div', 'alerts-rule');
    const mag = /** @type {HTMLInputElement} */ (el('input'));
    mag.type = 'number';
    mag.step = '0.1';
    mag.value = String(settings.quakeMinMag);
    mag.setAttribute('aria-label', 'Minimum earthquake magnitude');
    const radius = /** @type {HTMLInputElement} */ (el('input'));
    radius.type = 'number';
    radius.value = String(settings.quakeRadiusKm);
    radius.setAttribute('aria-label', 'Earthquake radius in km');
    const save = () => {
      settings.quakeMinMag = Number(mag.value) || settings.quakeMinMag;
      settings.quakeRadiusKm = Number(radius.value) || settings.quakeRadiusKm;
      writeAlertSettings(settings);
      settings = readAlertSettings();
    };
    mag.addEventListener('change', save);
    radius.addEventListener('change', save);
    quake.append(
      el(
        'span',
        'alerts-rule-label',
        'Earthquake minimum magnitude / radius (km) from view center',
      ),
      mag,
      radius,
    );
    rulesHost.append(quake);
  }

  function open() {
    root.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    renderRules();
    render();
  }
  function close() {
    root.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
  }
  const onChip = () => (root.hidden ? open() : close());
  const onKey = (event) => {
    if (!root.hidden && event.key === 'Escape') close();
  };
  chip.addEventListener('click', onChip);
  closeButton?.addEventListener('click', close);
  documentRef.addEventListener('keydown', onKey);
  chip.hidden = false;
  void run().then(schedule);

  function destroy() {
    disposed = true;
    clearTimeout(timer);
    lifetime.abort();
    chip.removeEventListener('click', onChip);
    closeButton?.removeEventListener('click', close);
    documentRef.removeEventListener('keydown', onKey);
  }
  signal?.addEventListener('abort', destroy, { once: true });
  return { open, close, run, destroy, feed };
}
