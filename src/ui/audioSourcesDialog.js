/**
 * "Your audio sources" dialog: add or remove ATC audio streams Rod owns or is
 * allowed to listen to. Opened by dispatching `gev:audio-sources-open` on the
 * window (the cockpit ATC page's SOURCES button does this).
 */

import { audioSourceStore } from '../audio/sources.js';

export const AUDIO_SOURCES_OPEN_EVENT = 'gev:audio-sources-open';

/**
 * @param {{ documentRef?: Document, store?: typeof audioSourceStore, signal?: AbortSignal }} [options]
 */
export function initAudioSourcesDialog({
  documentRef = globalThis.document,
  store = audioSourceStore,
  signal,
} = {}) {
  const root = documentRef?.getElementById?.('audio-sources');
  if (!root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const list = root.querySelector('[data-audio-sources-list]');
  const form = /** @type {HTMLFormElement|null} */ (
    root.querySelector('[data-audio-sources-form]')
  );
  const status = root.querySelector('[data-audio-sources-status]');
  const closeButton = root.querySelector('[data-audio-sources-close]');
  const win = documentRef.defaultView || globalThis;

  const text = (tag, className, value) => {
    const element = documentRef.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  };

  function render() {
    if (!list) return;
    list.textContent = '';
    const sources = store.list();
    if (!sources.length) {
      list.append(
        text(
          'p',
          'system-status-detail',
          'No sources yet. LiveATC is always offered as an external link and needs no entry here.',
        ),
      );
      return;
    }
    for (const source of sources) {
      const row = documentRef.createElement('section');
      row.className = 'system-status-row';
      const head = documentRef.createElement('div');
      head.className = 'system-status-row-head';
      head.append(
        text('span', 'system-status-name', source.label),
        text('span', 'system-status-pill', source.kind),
      );
      row.append(head);
      const where =
        [
          source.airportIcao,
          source.frequencyMHz ? `${source.frequencyMHz} MHz` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Any airport';
      row.append(
        text('p', 'system-status-detail', where),
        text('p', 'system-status-detail', source.url),
      );
      const remove = text('button', 'audio-source-remove', 'REMOVE');
      remove.type = 'button';
      remove.addEventListener('click', () => store.remove(source.id));
      row.append(remove);
      list.append(row);
    }
  }

  function open() {
    root.hidden = false;
    render();
    /** @type {HTMLElement|null} */ (
      form?.querySelector('input[name="url"]')
    )?.focus?.();
  }
  function close() {
    root.hidden = true;
  }

  const onSubmit = (event) => {
    event.preventDefault();
    if (!form) return;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const added = store.add(data);
      form.reset();
      if (status) status.textContent = `Added ${added.label}.`;
    } catch (error) {
      if (status)
        status.textContent = error?.message || 'Could not add that source.';
    }
  };
  const onKey = (event) => {
    if (!root.hidden && event.key === 'Escape') close();
  };
  form?.addEventListener('submit', onSubmit);
  closeButton?.addEventListener('click', close);
  win.addEventListener(AUDIO_SOURCES_OPEN_EVENT, open);
  documentRef.addEventListener('keydown', onKey);
  const unsubscribe = store.subscribe(render);

  function destroy() {
    form?.removeEventListener('submit', onSubmit);
    closeButton?.removeEventListener('click', close);
    win.removeEventListener(AUDIO_SOURCES_OPEN_EVENT, open);
    documentRef.removeEventListener('keydown', onKey);
    unsubscribe();
  }
  signal?.addEventListener('abort', destroy, { once: true });
  return { open, close, destroy };
}
