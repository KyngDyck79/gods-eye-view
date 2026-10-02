/**
 * SYSTEM STATUS — diagnostics v1. A chip shows the worst live provider
 * status; its dialog lists every gateway provider with its status, last
 * success, latency, budget use, license and required attribution, read from
 * GET /api/providers. Works on the dev and production servers alike.
 */

const POLL_MS = 30_000;
const OPEN_POLL_MS = 10_000;

/** Worst-first ordering of the statuses that should colour the chip. */
const SEVERITY = Object.freeze({
  OFFLINE: 5,
  NEEDS_KEY: 4,
  RATE_LIMITED: 3,
  DEGRADED: 2,
  IDLE: 1,
  ONLINE: 0,
  DISABLED: -1,
});

/**
 * The status the chip should show for a provider list.
 * @param {Array<{ status: string }>} providers
 * @returns {string}
 */
export function overallStatus(providers) {
  let worst = null;
  for (const provider of providers || []) {
    const rank = SEVERITY[provider?.status] ?? -1;
    if (rank < 0) continue;
    if (!worst || rank > SEVERITY[worst]) worst = provider.status;
  }
  return worst || 'IDLE';
}

/** "12 s ago", "4 min ago", "2 h ago"; "never" when unknown. */
export function formatAge(epochMs, now = Date.now()) {
  if (!Number.isFinite(epochMs)) return 'never';
  const seconds = Math.max(0, Math.round((now - epochMs) / 1000));
  if (seconds < 90) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** Human status label, e.g. "RATE LIMITED". */
export function statusLabel(status) {
  return String(status || 'IDLE').replace(/_/g, ' ');
}

/**
 * Plain-text detail lines for one provider row.
 * @param {any} provider
 * @param {number} [now]
 * @returns {string[]}
 */
export function providerDetailLines(provider, now = Date.now()) {
  const lines = [];
  const timing = [`Last success ${formatAge(provider.lastSuccessAt, now)}`];
  if (Number.isFinite(provider.latencyMs))
    timing.push(`${provider.latencyMs} ms`);
  if (
    Number.isFinite(provider.lastErrorAt) &&
    provider.lastErrorAt >= (provider.lastSuccessAt ?? 0)
  ) {
    timing.push(`last error ${formatAge(provider.lastErrorAt, now)}`);
  }
  lines.push(timing.join(' · '));
  const budget = provider.budget;
  if (budget) {
    const parts = [
      `${budget.usedLastMinute}/${budget.perMinute} requests this minute`,
    ];
    if (Number.isFinite(budget.dailyCredits)) {
      parts.push(
        `${budget.creditsUsedToday} credits used today, ${budget.creditsRemaining ?? '?'} left`,
      );
    }
    if (budget.blockedForMs > 0)
      parts.push(`paused ${Math.ceil(budget.blockedForMs / 1000)} s`);
    lines.push(parts.join(' · '));
  }
  lines.push(
    `${provider.cost} · ${provider.license} · commercial use: ${provider.commercialUse}`,
  );
  return lines;
}

/**
 * Wire the chip and dialog. Returns null (and removes the markup) when the
 * page has no gateway to ask.
 * @param {{ documentRef?: Document, fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 */
export function initSystemStatus({
  documentRef = globalThis.document,
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  signal,
} = {}) {
  const chip = documentRef?.getElementById?.('system-status-chip');
  const root = documentRef?.getElementById?.('system-status');
  if (!chip || !root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const list = root.querySelector('[data-system-status-list]');
  const mode = root.querySelector('[data-system-status-mode]');
  const chipLabel = chip.querySelector('[data-system-status-label]') || chip;
  const closeButton = root.querySelector('[data-system-status-close]');
  const lifetime = new AbortController();
  let timer = null;
  let open = false;
  let disposed = false;

  const text = (tag, className, value) => {
    const element = documentRef.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  };

  function renderList(payload) {
    if (!list) return;
    list.textContent = '';
    const now = Date.now();
    for (const provider of payload.providers || []) {
      const row = documentRef.createElement('section');
      row.className = 'system-status-row';
      row.dataset.status = provider.status;
      const head = documentRef.createElement('div');
      head.className = 'system-status-row-head';
      head.append(
        text('span', 'system-status-name', provider.name),
        text('span', 'system-status-pill', statusLabel(provider.status)),
      );
      row.append(head);
      if (provider.message)
        row.append(text('p', 'system-status-message', provider.message));
      for (const line of providerDetailLines(provider, now)) {
        row.append(text('p', 'system-status-detail', line));
      }
      if (provider.attribution?.text) {
        const credit = documentRef.createElement('a');
        credit.className = 'system-status-credit';
        credit.href = provider.attribution.url;
        credit.target = '_blank';
        credit.rel = 'noopener noreferrer';
        credit.textContent = provider.attribution.text;
        row.append(credit);
      }
      list.append(row);
    }
  }

  async function refresh() {
    if (disposed) return;
    try {
      const response = await fetchImpl('/api/providers', {
        cache: 'no-store',
        signal: lifetime.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      if (disposed) return;
      const overall = overallStatus(payload.providers);
      chip.dataset.status = overall;
      chipLabel.textContent = `SYSTEM · ${statusLabel(overall)}`;
      chip.title = `System status: ${statusLabel(overall)}`;
      if (mode) {
        mode.textContent =
          payload.usageMode === 'commercial'
            ? 'Usage mode: COMMERCIAL — providers whose terms forbid commercial use are off.'
            : 'Usage mode: PERSONAL';
      }
      if (open) renderList(payload);
    } catch (error) {
      if (disposed || error?.name === 'AbortError') return;
      chip.dataset.status = 'OFFLINE';
      chipLabel.textContent = 'SYSTEM · GATEWAY OFFLINE';
      if (open && list) {
        list.textContent = '';
        list.append(
          text(
            'p',
            'system-status-message',
            'The local gateway is not answering.',
          ),
        );
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (disposed) return;
    const hidden = documentRef.visibilityState === 'hidden';
    timer = setTimeout(
      async () => {
        await refresh();
        schedule();
      },
      open ? OPEN_POLL_MS : hidden ? POLL_MS * 4 : POLL_MS,
    );
  }

  function show() {
    if (open || disposed) return;
    open = true;
    root.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    void refresh();
    schedule();
    /** @type {HTMLElement|null} */ (closeButton)?.focus?.({
      preventScroll: true,
    });
  }

  function hide() {
    if (!open) return;
    open = false;
    root.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    /** @type {HTMLElement} */ (chip).focus?.({ preventScroll: true });
    schedule();
  }

  const onChip = () => (open ? hide() : show());
  const onKey = (event) => {
    if (open && event.key === 'Escape') hide();
  };
  chip.addEventListener('click', onChip);
  closeButton?.addEventListener('click', hide);
  documentRef.addEventListener('keydown', onKey);
  chip.hidden = false;
  void refresh();
  schedule();

  function destroy() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    lifetime.abort();
    chip.removeEventListener('click', onChip);
    closeButton?.removeEventListener('click', hide);
    documentRef.removeEventListener('keydown', onKey);
  }
  signal?.addEventListener('abort', destroy, { once: true });
  return { open: show, close: hide, refresh, destroy };
}
