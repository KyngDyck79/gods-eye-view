/**
 * Cockpit ATC page (GODS-EYE-VIEW-SPEC v2, 4.5 / 4.6): nearest airport and
 * runway, the estimated facility and frequency with its confidence and
 * reason, ATIS, the airport's METAR (decoded and raw) and TAF, and ATC audio
 * controls on the shared AudioBus. Methods run with the Cockpit controller as
 * `this`, like the other briefing pages.
 */

import { AUDIO_STATES, audioBus } from '../audio/audioBus.js';
import { audioSourceStore, getAudioSources } from '../audio/sources.js';
import { createStreamPlayer } from '../audio/streamPlayer.js';

/** Window event that opens the "Your audio sources" dialog. */
const AUDIO_SOURCES_OPEN_EVENT = 'gev:audio-sources-open';

/** Re-ask the frequency engine at most this often for one aircraft… */
export const ATC_REFRESH_MS = 15_000;
/** …or sooner once it has moved this far. */
export const ATC_REFRESH_DISTANCE_NM = 2;
/** Weather for the chosen airport is re-read at most this often. */
export const ATC_WEATHER_REFRESH_MS = 2 * 60_000;

const M_TO_FT = 3.28084;
const MPS_TO_KTS = 1.943844;
const MPS_TO_FPM = 196.8504;

/**
 * Query string for /api/airports/frequency from cockpit aircraft info.
 * @param {any} info
 * @param {{ stationarySec?: number }} [extra]
 */
export function atcQueryParams(info, { stationarySec = 0 } = {}) {
  const params = new URLSearchParams({
    lat: info.latitude.toFixed(5),
    lon: info.longitude.toFixed(5),
  });
  const set = (key, value, digits = 0) => {
    if (Number.isFinite(value)) params.set(key, value.toFixed(digits));
  };
  set('alt', Number.isFinite(info.altitudeM) ? info.altitudeM * M_TO_FT : null);
  set(
    'gs',
    Number.isFinite(info.velocityMps) ? info.velocityMps * MPS_TO_KTS : null,
  );
  set(
    'trk',
    Number.isFinite(info.track) ? ((info.track % 360) + 360) % 360 : null,
  );
  set(
    'vs',
    Number.isFinite(info.verticalRateMps)
      ? info.verticalRateMps * MPS_TO_FPM
      : null,
  );
  if (info.onGround) params.set('gnd', '1');
  if (stationarySec > 0) params.set('still', String(Math.round(stationarySec)));
  const origin = info.route?.origin?.code;
  const destination = info.route?.destination?.code;
  if (origin) params.set('orig', origin);
  if (destination) params.set('dest', destination);
  return params;
}

const dash = '—';
const nm = (value) =>
  Number.isFinite(value)
    ? `${value < 10 ? value.toFixed(1) : Math.round(value)} NM`
    : dash;
const mhz = (value) =>
  Number.isFinite(value) ? String(Number(value.toFixed(3))) : dash;

/** Minutes/hours age text for a report. */
export function reportAge(ageMs) {
  if (!Number.isFinite(ageMs)) return dash;
  const minutes = Math.round(ageMs / 60_000);
  return minutes < 90
    ? `${minutes} MIN AGO`
    : `${Math.round(minutes / 60)} H AGO`;
}

/**
 * Plain view model for the ATC page. Pure, so it is unit-testable.
 * @param {{ frequency?: any, metar?: any, taf?: any, weatherError?: string|null }} [input]
 */
export function atcViewModel({
  frequency = null,
  metar = null,
  taf = null,
  weatherError = null,
} = {}) {
  const airport = frequency?.airport;
  const code = airport ? airport.icao || airport.ident : null;
  const runway = frequency?.alignedRunway || frequency?.runway || null;
  const view = {
    status: null,
    airport: code || dash,
    airportDetail: airport
      ? `${airport.name} · ${nm(frequency.distanceNm)}`
      : frequency?.note || 'NO AIRPORT WITHIN 60 NM',
    runway: runway ? `RWY ${runway.ident}` : dash,
    runwayDetail: runway
      ? [
          frequency?.alignedRunway ? 'ALIGNED' : 'NEAREST',
          Number.isFinite(runway.lengthFt)
            ? `${runway.lengthFt.toLocaleString('en-US')} FT`
            : null,
          nm(runway.distanceNm),
        ]
          .filter(Boolean)
          .join(' · ')
      : dash,
    facility: frequency?.facilityName
      ? frequency.facilityName.toUpperCase()
      : dash,
    confidence: frequency?.confidence
      ? `${frequency.confidence} CONFIDENCE · ESTIMATE`
      : dash,
    frequency: frequency?.frequencyMHz
      ? mhz(frequency.frequencyMHz)
      : frequency?.facility === 'EN_ROUTE'
        ? 'NOT IN DATASET'
        : dash,
    atis: frequency?.atis?.length
      ? `ATIS ${frequency.atis.map((a) => mhz(a.mhz)).join(' / ')}`
      : 'NO ATIS LISTED',
    reason: frequency?.reason || dash,
    category: dash,
    metarAge: dash,
    metarSummary: code ? 'NO METAR FOR THIS AIRPORT' : dash,
    metarRaw: dash,
    tafRaw: code ? `TAF ${dash} NONE ISSUED FOR ${code}` : `TAF ${dash}`,
    metarStale: false,
  };
  if (weatherError) {
    view.metarSummary = weatherError;
  }
  if (metar) {
    view.category = `${metar.flightCategory || 'CATEGORY UNKNOWN'} · ${metar.station}`;
    view.metarAge = `${reportAge(metar.ageMs)}${metar.stale ? ' · STALE' : ''}`;
    view.metarSummary = metar.summary;
    view.metarRaw = metar.raw;
    view.metarStale = Boolean(metar.stale);
  }
  if (taf) view.tafRaw = taf.raw;
  return view;
}

/**
 * Look up the page's elements once.
 * @this {any} The Cockpit controller.
 */
export function initAtcElements() {
  const byId = (id) => document.getElementById(id);
  this.atc = {
    status: byId('cockpit-atc-status'),
    airport: byId('cockpit-atc-airport'),
    airportDetail: byId('cockpit-atc-airport-detail'),
    runway: byId('cockpit-atc-runway'),
    runwayDetail: byId('cockpit-atc-runway-detail'),
    facility: byId('cockpit-atc-facility'),
    confidence: byId('cockpit-atc-confidence'),
    frequency: byId('cockpit-atc-frequency'),
    atis: byId('cockpit-atc-atis'),
    reason: byId('cockpit-atc-reason'),
    category: byId('cockpit-atc-category'),
    metarAge: byId('cockpit-atc-metar-age'),
    metarSummary: byId('cockpit-atc-metar-summary'),
    metarRaw: byId('cockpit-atc-metar-raw'),
    tafRaw: byId('cockpit-atc-taf-raw'),
    listen: byId('cockpit-atc-listen'),
    stop: byId('cockpit-atc-stop'),
    mute: byId('cockpit-atc-mute'),
    volume: byId('cockpit-atc-volume'),
    audioFrequency: byId('cockpit-atc-audio-frequency'),
    audioSource: byId('cockpit-atc-audio-source'),
    audioStatus: byId('cockpit-atc-audio-status'),
    audioDetail: byId('cockpit-atc-audio-detail'),
    source: byId('cockpit-atc-source'),
    sources: byId('cockpit-atc-sources'),
    external: byId('cockpit-atc-external'),
  };
  this.atcState = {
    subject: null,
    anchor: null,
    fetchedAt: 0,
    abort: null,
    stoppedSince: null,
    frequency: null,
    weather: { code: null, fetchedAt: 0, metar: null, taf: null, error: null },
  };
  const { mute, volume, stop, listen, source, sources, external } = this.atc;
  this.atcPlayer = createStreamPlayer();
  this.atcSources = [];
  this.atcExternalOpenedFor = null;
  const onListen = () => {
    const chosen = this.atcSources.find(
      (candidate) =>
        candidate.embeddable &&
        candidate.id === /** @type {HTMLSelectElement} */ (source)?.value,
    );
    if (chosen) void this.atcPlayer.play(chosen);
  };
  const onSources = () =>
    (document.defaultView || window).dispatchEvent(
      new CustomEvent(AUDIO_SOURCES_OPEN_EVENT),
    );
  const onExternal = () => {
    this.atcExternalOpenedFor = external?.dataset.icao || null;
    this.renderAtcAudio();
  };
  const onMute = () => audioBus.setMuted(!audioBus.getState().muted);
  const onVolume = () =>
    audioBus.setVolume(
      Number(/** @type {HTMLInputElement} */ (volume).value) / 100,
    );
  const onStop = () => this.atcPlayer.stop();
  const onSourceChange = () => this.renderAtcAudio();
  mute?.addEventListener('click', onMute);
  volume?.addEventListener('input', onVolume);
  stop?.addEventListener('click', onStop);
  listen?.addEventListener('click', onListen);
  sources?.addEventListener('click', onSources);
  external?.addEventListener('click', onExternal);
  source?.addEventListener('change', onSourceChange);
  const unsubscribe = audioBus.subscribe(() => this.renderAtcAudio());
  const unsubscribePlayer = this.atcPlayer.subscribe(() =>
    this.renderAtcAudio(),
  );
  const unsubscribeSources = audioSourceStore.subscribe(() =>
    this.refreshAtcSources(),
  );
  this._listenerRemovers?.push(
    () => mute?.removeEventListener('click', onMute),
    () => volume?.removeEventListener('input', onVolume),
    () => stop?.removeEventListener('click', onStop),
    () => listen?.removeEventListener('click', onListen),
    () => sources?.removeEventListener('click', onSources),
    () => external?.removeEventListener('click', onExternal),
    () => source?.removeEventListener('change', onSourceChange),
    unsubscribe,
    unsubscribePlayer,
    unsubscribeSources,
    () => this.atcPlayer?.destroy(),
    () => this.atcState?.abort?.abort(),
  );
}

/**
 * Rebuild the source list for the current airport and frequency.
 * @this {any} The Cockpit controller.
 */
export function refreshAtcSources() {
  const a = this.atc;
  if (!a) return;
  const frequency = this.atcState?.frequency;
  const airport = frequency?.airport;
  const icao = airport ? airport.icao || airport.ident : null;
  this.atcSources = getAudioSources(audioSourceStore, {
    airportIcao: icao,
    facilityType: frequency?.facility || null,
    frequencyMHz: frequency?.frequencyMHz ?? null,
  });
  const playable = this.atcSources.filter((s) => s.embeddable);
  if (a.source) {
    const select = /** @type {HTMLSelectElement} */ (a.source);
    const previous = select.value;
    select.textContent = '';
    if (!playable.length) {
      select.append(new Option('NO SOURCE FOR THIS AIRPORT', ''));
    }
    for (const s of playable) {
      const where = [s.airportIcao, s.frequencyMHz ? `${s.frequencyMHz}` : null]
        .filter(Boolean)
        .join(' ');
      select.append(
        new Option(`${s.kind} · ${s.label}${where ? ` · ${where}` : ''}`, s.id),
      );
    }
    if (playable.some((s) => s.id === previous)) select.value = previous;
    select.disabled = !playable.length;
  }
  const external = this.atcSources.find((s) => !s.embeddable);
  if (a.external) {
    a.external.hidden = !external;
    if (external) {
      a.external.href = external.url;
      a.external.dataset.icao = external.airportIcao || '';
      a.external.textContent = `LISTEN ON EXTERNAL SOURCE · ${external.label} ↗`;
      a.external.title = `${external.credit}: ${external.license}`;
    }
  }
  this.renderAtcAudio();
}

/**
 * ATC audio controls. The status comes from the player, which decides LIVE
 * from real playback plus measured activity; nothing here assumes it.
 * @this {any} The Cockpit controller.
 */
export function renderAtcAudio() {
  const a = this.atc;
  if (!a) return;
  const bus = audioBus.getState();
  const player = this.atcPlayer?.getState?.() || null;
  const frequency = this.atcState?.frequency;
  const playing = player && player.phase !== 'idle';
  const airport = frequency?.airport;
  const icao = airport ? airport.icao || airport.ident : null;
  if (a.audioFrequency)
    a.audioFrequency.textContent = `FREQ ${frequency?.frequencyMHz ? mhz(frequency.frequencyMHz) : dash}`;
  if (a.audioSource)
    a.audioSource.textContent = `SOURCE ${playing ? player.source?.label || dash : dash}`;
  let status = player?.state || AUDIO_STATES.NONE;
  if (!playing && icao && this.atcExternalOpenedFor === icao) {
    status = AUDIO_STATES.EXTERNAL;
  }
  if (a.audioStatus) {
    a.audioStatus.textContent = status;
    a.audioStatus.dataset.live = String(Boolean(player?.live));
  }
  if (a.audioDetail) {
    a.audioDetail.textContent =
      status === AUDIO_STATES.EXTERNAL
        ? 'Opened on LiveATC in another tab; not played here'
        : player?.detail || '';
  }
  const selected = /** @type {HTMLSelectElement|null} */ (a.source)?.value;
  if (a.listen) {
    a.listen.disabled = !selected;
    a.listen.title = selected
      ? 'Play the selected source'
      : 'Add a source for this airport first (SOURCES)';
  }
  if (a.stop) a.stop.disabled = !playing;
  if (a.mute) {
    a.mute.setAttribute('aria-pressed', String(bus.muted));
    a.mute.textContent = bus.muted ? 'UNMUTE' : 'MUTE';
  }
  if (a.volume && document.activeElement !== a.volume)
    a.volume.value = String(Math.round(bus.volume * 100));
}

/** @this {any} */
function renderAtcView(view) {
  const a = this.atc;
  if (!a) return;
  for (const key of [
    'airport',
    'airportDetail',
    'runway',
    'runwayDetail',
    'facility',
    'confidence',
    'frequency',
    'atis',
    'reason',
    'category',
    'metarAge',
    'metarSummary',
    'metarRaw',
    'tafRaw',
  ]) {
    if (a[key]) a[key].textContent = view[key];
  }
  if (a.metarAge) a.metarAge.dataset.stale = String(view.metarStale);
  if (a.status) {
    a.status.hidden = !view.status;
    a.status.textContent = view.status || '';
  }
}

async function fetchJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

/**
 * Called with every cockpit context update. Re-asks the gateway when the
 * aircraft changed, moved ATC_REFRESH_DISTANCE_NM, or ATC_REFRESH_MS passed.
 * @this {any} The Cockpit controller.
 */
export function maybeRefreshAtcBrief(info) {
  if (this.destroyed || !this.active || !this.atc) return;
  if (!Number.isFinite(info?.latitude) || !Number.isFinite(info?.longitude))
    return;
  const s = this.atcState;
  const subject = `${info.layerId || 'aircraft'}:${info.icao24 || info.callsign || 'unknown'}`;
  const now = Date.now();
  const stopped =
    info.onGround &&
    Number.isFinite(info.velocityMps) &&
    info.velocityMps * MPS_TO_KTS < 2;
  s.stoppedSince = stopped ? (s.stoppedSince ?? now) : null;
  if (subject !== s.subject) {
    s.abort?.abort();
    s.abort = null;
    s.subject = subject;
    s.anchor = null;
    s.fetchedAt = 0;
    s.frequency = null;
    renderAtcView.call(this, {
      ...atcViewModel({}),
      status: 'ACQUIRING AIRPORT DATA',
    });
  }
  const moved = s.anchor
    ? Math.hypot(
        (info.latitude - s.anchor.lat) * 60,
        (info.longitude - s.anchor.lon) *
          60 *
          Math.cos((info.latitude * Math.PI) / 180),
      )
    : Infinity;
  if (
    s.abort ||
    (now - s.fetchedAt < ATC_REFRESH_MS && moved < ATC_REFRESH_DISTANCE_NM)
  )
    return;

  const controller = new AbortController();
  s.abort = controller;
  s.anchor = { lat: info.latitude, lon: info.longitude };
  s.fetchedAt = now;
  const fetchImpl =
    this.services?.fetchImpl ||
    ((input, init) => globalThis.fetch(input, init));
  const params = atcQueryParams(info, {
    stationarySec: s.stoppedSince ? (now - s.stoppedSince) / 1000 : 0,
  });
  void (async () => {
    try {
      const freq = await fetchJson(
        fetchImpl,
        `/api/airports/frequency?${params}`,
        controller.signal,
      );
      if (controller.signal.aborted || s.subject !== subject) return;
      if (!freq.ok) {
        renderAtcView.call(this, {
          ...atcViewModel({}),
          status: freq.body?.error || 'AIRPORT DATA UNAVAILABLE',
        });
        return;
      }
      s.frequency = freq.body;
      const code = freq.body.airport
        ? freq.body.airport.icao || freq.body.airport.ident
        : null;
      const w = s.weather;
      if (
        code &&
        (code !== w.code || Date.now() - w.fetchedAt >= ATC_WEATHER_REFRESH_MS)
      ) {
        w.code = code;
        w.fetchedAt = Date.now();
        const [metar, taf] = await Promise.all([
          fetchJson(
            fetchImpl,
            `/api/avwx/metar?ids=${encodeURIComponent(code)}`,
            controller.signal,
          ),
          fetchJson(
            fetchImpl,
            `/api/avwx/taf?ids=${encodeURIComponent(code)}`,
            controller.signal,
          ),
        ]);
        if (controller.signal.aborted || s.subject !== subject) return;
        w.metar = metar.ok ? metar.body.metars?.[0] || null : null;
        w.taf = taf.ok ? taf.body.tafs?.[0] || null : null;
        w.error = metar.ok
          ? null
          : metar.body?.error || 'WEATHER DATA TEMPORARILY UNAVAILABLE';
        // Many small fields publish no METAR: show the nearest station that
        // does, labeled with its own identifier so it is never mistaken.
        const field = freq.body.airport;
        if (metar.ok && !w.metar && Number.isFinite(field?.lat)) {
          const near = await fetchJson(
            fetchImpl,
            `/api/avwx/nearest?lat=${field.lat}&lon=${field.lon}&radiusNm=30&limit=1`,
            controller.signal,
          );
          if (controller.signal.aborted || s.subject !== subject) return;
          const nearest = near.ok ? near.body.metars?.[0] : null;
          if (nearest) {
            w.metar = {
              ...nearest,
              summary: `Nearest report, ${nearest.station} (${nearest.distanceNm} nm from ${code}): ${nearest.summary}`,
            };
          }
        }
      } else if (!code) {
        Object.assign(w, { code: null, metar: null, taf: null, error: null });
      }
      renderAtcView.call(
        this,
        atcViewModel({
          frequency: freq.body,
          metar: w.metar,
          taf: w.taf,
          weatherError: w.error,
        }),
      );
      this.refreshAtcSources();
    } catch (error) {
      if (controller.signal.aborted) return;
      renderAtcView.call(this, {
        ...atcViewModel({}),
        status: 'AIRPORT DATA UNAVAILABLE',
      });
      console.warn('[Cockpit ATC]', error?.message || error);
    } finally {
      if (s.abort === controller) s.abort = null;
    }
  })();
}
