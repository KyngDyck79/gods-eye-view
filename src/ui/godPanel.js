/**
 * GOD console (GODS-EYE-VIEW-SPEC v2, 4.19): type a command or question,
 * see replies (voice turns appear here too), and open the debug drawer with
 * every tool call and result.
 */

import {
  getGod,
  getGodDebug,
  onGodEvent,
  pushGodExchange,
} from '../god/instance.js';

/** @param {{ documentRef?: Document, signal?: AbortSignal, fetchImpl?: typeof fetch }} [options] */
export function initGodPanel({
  documentRef = globalThis.document,
  signal,
  fetchImpl = (i, n) => globalThis.fetch(i, n),
} = {}) {
  const doc = documentRef;
  if (!doc?.body || doc.getElementById('god-panel')) return null;
  const chip = doc.createElement('button');
  chip.id = 'god-chip';
  chip.type = 'button';
  chip.textContent = 'GOD';
  chip.title = 'Ask GOD (type or speak)';
  chip.setAttribute('aria-controls', 'god-panel');
  chip.setAttribute('aria-expanded', 'false');
  const panel = doc.createElement('aside');
  panel.id = 'god-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'GOD assistant');
  panel.innerHTML = `
    <header class="system-status-header">
      <span class="system-status-kicker">GOD'S EYE VIEW · GOD</span>
      <button type="button" class="system-status-close" data-god-close aria-label="Close GOD">✕</button>
    </header>
    <p class="vs-note" data-god-status>Commands work offline. Examples: “track DAL45”, “nearest airport”, “weather here”, “show severe weather”, “cameras near KMYR”, “which ATC frequency”.</p>
    <div class="god-log" data-god-log aria-live="polite"></div>
    <form class="god-form" data-god-form>
      <input type="text" data-god-input placeholder="Ask GOD…" autocomplete="off" aria-label="Command or question for GOD">
      <button type="submit" class="scene-btn">ASK</button>
    </form>
    <details class="god-debug">
      <summary>DEBUG · tool calls</summary>
      <pre data-god-debug></pre>
    </details>`;
  doc.body.append(chip, panel);
  const log = panel.querySelector('[data-god-log]');
  const input = /** @type {HTMLInputElement} */ (
    panel.querySelector('[data-god-input]')
  );
  const debugPre = panel.querySelector('[data-god-debug]');
  const statusLine = panel.querySelector('[data-god-status]');

  function addLine(who, text, meta = '') {
    const row = doc.createElement('div');
    row.className = `god-line god-${who}`;
    const label = doc.createElement('strong');
    label.textContent = who === 'you' ? 'YOU' : 'GOD';
    const body = doc.createElement('span');
    body.textContent = text;
    row.append(label, body);
    if (meta) {
      const m = doc.createElement('em');
      m.textContent = meta;
      row.append(m);
    }
    log.append(row);
    while (log.children.length > 40) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function renderDebug() {
    debugPre.textContent = getGodDebug()
      .slice(-25)
      .map(
        (e) =>
          `${new Date(e.at).toISOString().slice(11, 19)}Z ${e.kind}${e.name ? ` ${e.name}` : ''} ${JSON.stringify(e.args ?? e.parsed ?? e.toolCalls ?? e.result ?? e.reply ?? e.text ?? '').slice(0, 600)}`,
      )
      .join('\n');
  }

  async function refreshStatus() {
    try {
      const s = await (
        await fetchImpl('/api/god/status', { cache: 'no-store' })
      ).json();
      statusLine.dataset.ai = s.configured ? 'on' : 'off';
      statusLine.textContent += s.configured
        ? ` · AI tier: ${s.provider} ${s.model}.`
        : ' · AI tier: not configured (free-form questions need AI_API_KEY).';
    } catch {
      /* status is informational */
    }
  }

  panel
    .querySelector('[data-god-form]')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const god = getGod();
      if (!god) {
        addLine('god', 'GOD is still starting — try again in a moment.');
        return;
      }
      addLine('you', text);
      try {
        const r = await god.handle(text);
        addLine('god', r.reply, r.tier === 2 ? 'AI tier' : 'command');
      } catch (error) {
        addLine('god', error?.message || 'That command failed.');
      }
    });
  const off = onGodEvent((e) => {
    if (e.type === 'debug' && !panel.hidden) renderDebug();
    if (e.type === 'exchange') {
      addLine('you', `🎙 ${e.exchange.text}`);
      addLine('god', e.exchange.reply, 'voice');
    }
  });

  const open = () => {
    panel.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    renderDebug();
    input.focus();
  };
  const close = () => {
    panel.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
  };
  chip.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.querySelector('[data-god-close]').addEventListener('click', close);
  const onKey = (event) => {
    if (event.key === 'Escape' && !panel.hidden) close();
  };
  doc.addEventListener('keydown', onKey);
  void refreshStatus();
  signal?.addEventListener(
    'abort',
    () => {
      off();
      doc.removeEventListener('keydown', onKey);
      chip.remove();
      panel.remove();
    },
    { once: true },
  );
  return { open, close, addLine };
}

/** Wrap a GOD handler so voice exchanges also show in the console. */
export function withConsoleEcho(handle) {
  return async (text) => {
    const r = await handle(text);
    if (r?.reply) pushGodExchange({ text, reply: r.reply });
    return r;
  };
}
