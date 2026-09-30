/**
 * Phone layout (GODS-EYE-VIEW-SPEC v2, 4.26): at 700 px wide or less the
 * desktop panels step aside for a bottom tab bar (AIR / GROUND / WEATHER /
 * MORE). Each tab opens a bottom sheet of layer switches; MORE reaches the
 * full panels, status, alerts, GOD and voice settings. Voice and GOD stay in
 * thumb reach. Polling is halved on phones (see DataLayerManager).
 */

export const MOBILE_QUERY = '(max-width: 700px)';

/** Voice button labels: off, on, error. */
const VOICE_LABELS = ['VOICE', 'VOICE ON', 'VOICE !'];

export const MOBILE_TABS = Object.freeze({
  AIR: ['flights', 'military', 'local-adsb', 'satellites', 'rocket-launches'],
  GROUND: [
    'traffic-incidents',
    'traffic',
    'transit',
    'emergency-facilities',
    'ais-live-vessels',
    'cctv',
  ],
  WEATHER: [
    'weather',
    'nws-warnings',
    'earthquakes',
    'natural-events',
    'local-firms',
    'cyclones',
  ],
});

/** @param {{ documentRef?: Document, dataManager?: any, signal?: AbortSignal }} [options] */
export function initMobileLayout({
  documentRef = globalThis.document,
  dataManager = null,
  signal,
} = {}) {
  const doc = documentRef;
  const win = doc?.defaultView;
  if (!doc?.body || !win?.matchMedia || doc.getElementById('mobile-tabbar'))
    return null;
  const media = win.matchMedia(MOBILE_QUERY);
  const bar = doc.createElement('nav');
  bar.id = 'mobile-tabbar';
  bar.setAttribute('aria-label', 'Sections');
  const sheet = doc.createElement('section');
  sheet.id = 'mobile-sheet';
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  let current = null;

  for (const tab of ['AIR', 'GROUND', 'VOICE', 'WEATHER', 'MORE']) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.tab = tab;
    b.textContent = tab;
    if (tab === 'VOICE') bindVoiceButton(b);
    else
      b.addEventListener('click', () =>
        current === tab ? closeSheet() : openSheet(tab),
      );
    bar.append(b);
  }
  doc.body.append(bar, sheet);

  /**
   * The voice button in thumb reach: tap turns voice on or off (the dock's
   * mic button); press and hold talks (the same Space push-to-talk the
   * voice session listens for).
   */
  function bindVoiceButton(button) {
    let holdTimer = null;
    let holding = false;
    const key = (type) =>
      doc.dispatchEvent(
        new win.KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true }),
      );
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      holding = false;
      holdTimer = win.setTimeout(() => {
        holding = true;
        key('keydown');
      }, 300);
    });
    button.addEventListener('pointerup', () => {
      win.clearTimeout(holdTimer);
      if (holding) key('keyup');
      else doc.getElementById('gev-voice-button')?.click();
      holding = false;
    });
    button.addEventListener('pointercancel', () => {
      win.clearTimeout(holdTimer);
      if (holding) key('keyup');
      holding = false;
    });
    let lastStatus = 'idle';
    const sync = () => {
      const status =
        doc.getElementById('gev-voice-control')?.dataset.status || 'idle';
      if (status === 'error' && lastStatus !== 'error' && media.matches)
        showVoiceError();
      lastStatus = status;
      const failed = status === 'error';
      const live = !failed && status !== 'idle';
      button.dataset.live = String(live);
      button.textContent = VOICE_LABELS[failed ? 2 : live ? 1 : 0];
    };
    new win.MutationObserver(sync).observe(doc.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-status'],
    });
    sync();
  }

  /** The dock is hidden on phones, so voice errors are shown in the sheet. */
  function showVoiceError() {
    current = 'VOICE';
    sheet.textContent = '';
    const head = doc.createElement('header');
    head.textContent = 'VOICE';
    const detail = doc.createElement('p');
    detail.className = 'vs-warning';
    detail.textContent =
      doc.getElementById('gev-voice-detail')?.textContent ||
      'Voice could not start.';
    sheet.append(
      head,
      detail,
      actionButton('VOICE SETTINGS', () =>
        doc.getElementById('gev-voice-settings-btn')?.click(),
      ),
    );
    sheet.hidden = false;
  }

  function closeSheet() {
    current = null;
    sheet.hidden = true;
    for (const b of bar.querySelectorAll('button'))
      b.setAttribute('aria-pressed', 'false');
  }

  function layerRow(entry) {
    const row = doc.createElement('label');
    row.className = 'mobile-layer';
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(entry.enabled);
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        await dataManager.setEnabled(entry.id, box.checked, { origin: 'user' });
      } finally {
        box.disabled = false;
        box.checked = Boolean(dataManager.layers.get(entry.id)?.enabled);
      }
    });
    const name = doc.createElement('span');
    name.textContent = entry.name || entry.id;
    row.append(box, name);
    return row;
  }

  function actionButton(label, run) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'scene-btn';
    b.textContent = label;
    b.addEventListener('click', () => {
      closeSheet();
      run();
    });
    return b;
  }

  function openSheet(tab) {
    current = tab;
    for (const b of bar.querySelectorAll('button'))
      b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    sheet.textContent = '';
    const head = doc.createElement('header');
    head.textContent = tab;
    sheet.append(head);
    if (tab === 'MORE') {
      const click = (id) => () => doc.getElementById(id)?.click();
      sheet.append(
        actionButton(
          doc.body.classList.contains('gev-mobile-panels')
            ? 'HIDE FULL PANELS'
            : 'SHOW FULL PANELS',
          () => doc.body.classList.toggle('gev-mobile-panels'),
        ),
        actionButton('GOD — ASK, SEARCH, “GO TO …”', click('god-chip')),
        actionButton('ALERTS', click('alerts-chip')),
        actionButton('SYSTEM STATUS', click('system-status-chip')),
        actionButton('VOICE SETTINGS', click('gev-voice-settings-btn')),
        actionButton('API KEYS', click('key-setup-chip')),
      );
    } else {
      const all = new Map(
        (dataManager?.getAll?.() || []).map((l) => [l.id, l]),
      );
      const ids = MOBILE_TABS[tab].filter((id) => all.has(id));
      if (!ids.length)
        sheet.append(doc.createTextNode('No layers in this section.'));
      for (const id of ids) sheet.append(layerRow(all.get(id)));
    }
    sheet.hidden = false;
  }

  const apply = () => {
    doc.body.classList.toggle('gev-mobile', media.matches);
    if (!media.matches) closeSheet();
  };
  apply();
  media.addEventListener('change', apply);
  const onKey = (e) => {
    if (e.key === 'Escape' && current) closeSheet();
  };
  doc.addEventListener('keydown', onKey);
  signal?.addEventListener(
    'abort',
    () => {
      media.removeEventListener('change', apply);
      doc.removeEventListener('keydown', onKey);
      doc.body.classList.remove('gev-mobile', 'gev-mobile-panels');
      bar.remove();
      sheet.remove();
    },
    { once: true },
  );
  return { openSheet, closeSheet };
}
