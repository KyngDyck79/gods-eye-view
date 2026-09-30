/**
 * GOD, the assistant (GODS-EYE-VIEW-SPEC v2, 4.19).
 *
 * Tier 1: the deterministic parser (./parser.js) with handlers that answer
 * only from live app data, always stating its age. Works without any key.
 * Tier 2: optional LLM through the gateway (/api/god/chat) with app tools;
 * without AI_API_KEY free-form questions get AI_NOT_CONFIGURED.
 *
 * `tools` is injected (./tools.js in the app, fakes in tests).
 */

import { describeAircraft } from '../voice/local/aviationSpeech.js';
import { parseCommand } from './parser.js';
import {
  AI_NOT_CONFIGURED,
  M_TO_FT,
  NOT_AVAILABLE,
  ageText,
  cardinal,
} from './phrasing.js';

export const GOD_SYSTEM_RULES = [
  "You are GOD, the assistant inside God's Eye View, a live map of aircraft, weather, traffic, cameras, ships and events.",
  'Answer only from tool results returned in this turn. Never use outside knowledge for facts about the current situation.',
  'Include the data age from the tool results, e.g. "as of 12 seconds ago".',
  'Say "estimated" or "plausible" wherever a tool result marks data as estimated.',
  `When the tools return nothing useful, reply exactly: "${NOT_AVAILABLE}"`,
  'Keep replies short enough to be read aloud. Use tools to act on the map when asked.',
].join('\n');

const MAX_TOOL_ROUNDS = 5;

/**
 * @param {{ tools: any, fetchImpl?: typeof fetch, now?: () => number, onDebug?: (entry: any) => void }} options
 */
export function createGod({
  tools,
  fetchImpl = (i, n) => globalThis.fetch(i, n),
  now = Date.now,
  onDebug = () => {},
}) {
  const debug = (entry) => {
    try {
      onDebug({ at: now(), ...entry });
    } catch {
      /* the drawer is optional */
    }
  };

  /** Where "here" / "there" / a named place is. */
  async function resolvePoint(slots) {
    const ctx = tools.context();
    if (slots.ref === 'there') {
      const sel = ctx.selection;
      if (sel && Number.isFinite(sel.lat))
        return {
          lat: sel.lat,
          lon: sel.lon,
          label: sel.label || 'the selection',
        };
      return ctx.center ? { ...ctx.center, label: 'the map center' } : null;
    }
    if (slots.ref === 'place') {
      const found = await tools.findPlace(slots.place);
      return found || null;
    }
    return ctx.center ? { ...ctx.center, label: 'the map center' } : null;
  }

  function aircraftReply(a) {
    if (!a)
      return {
        reply:
          'No aircraft is selected. Click one, or say “track” and its callsign.',
      };
    const ageMs = Number.isFinite(a.positionEpochMs)
      ? now() - a.positionEpochMs
      : null;
    const altFt = Number.isFinite(a.altitudeM) ? a.altitudeM * M_TO_FT : null;
    const parts = [
      a.callsign || a.registration || a.icao24,
      a.typeName,
      a.onGround
        ? 'on the ground'
        : Number.isFinite(altFt)
          ? `${Math.round(altFt / 100) * 100} ft`
          : null,
      Number.isFinite(a.speedMps)
        ? `${Math.round(a.speedMps * 1.94384)} kt`
        : null,
      a.routeOrigin && a.routeDestination
        ? `${a.routeOrigin} → ${a.routeDestination} (route per adsbdb)`
        : null,
      ageMs != null
        ? `position ${ageText(ageMs)}`
        : 'position time not reported',
    ].filter(Boolean);
    return {
      reply: parts.join(' · '),
      speech: describeAircraft(
        {
          callsign: a.callsign,
          registration: a.registration,
          icao24: a.icao24,
          typeName: a.typeName,
          altitudeFt: a.onGround ? 0 : altFt,
          ageSec: ageMs != null ? ageMs / 1000 : null,
        },
        tools.speechOptions?.() || {},
      ),
    };
  }

  async function nearestAirportDetail() {
    const c = tools.context().center;
    if (!c) return null;
    const near = (
      await tools
        .getJson(
          `/api/airports/nearest?lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}&limit=1&types=large_airport,medium_airport,small_airport`,
        )
        .catch(() => null)
    )?.airports?.[0];
    if (!near) return null;
    const full = await tools
      .getJson(`/api/airports/${encodeURIComponent(near.icao || near.ident)}`)
      .catch(() => null);
    return full?.airport || near;
  }

  /** A failed layer change, with the layer's own reason when it has one. */
  function layerFailure(r, layerId, enabled) {
    const reason = tools.layerError?.(layerId);
    const name =
      r?.label || tools.layers().find((l) => l.id === layerId)?.name || layerId;
    return `${name} could not be turned ${enabled ? 'on' : 'off'}${reason ? `: ${reason}` : '.'}`;
  }

  const handlers = {
    async track({ query, ref }) {
      if (ref === 'there') {
        const sel = tools.context().selection;
        if (!sel) return { reply: 'Nothing is selected to track.' };
        query = sel.label;
      }
      const r = await tools.run('track_entity', { query });
      if (r?.ok === false || !r)
        return { reply: `Nothing called “${query}” is in the current data.` };
      const a = tools.trackedAircraft();
      return a
        ? { ...aircraftReply(a), reply: `Tracking ${aircraftReply(a).reply}` }
        : { reply: `Tracking ${r.label || query}.` };
    },
    async showLayerNear({ layerId, ...slots }) {
      const point = await resolvePoint(slots);
      if (!point) return { reply: `I couldn't find “${slots.place}”.` };
      if (slots.ref === 'place') await tools.flyTo(point);
      const r = await tools.run('set_layer_visibility', {
        layerId,
        enabled: true,
      });
      if (r?.ok === false) return { reply: layerFailure(r, layerId, true) };
      return { reply: `Showing ${r?.label || layerId} near ${point.label}.` };
    },
    async openCockpit() {
      const r = await tools.run('control_cockpit', { action: 'enter' });
      return {
        reply:
          r?.ok === false
            ? r.error ||
              'Select or track an aircraft first, then open the cockpit.'
            : `Cockpit open${r?.label ? ` for ${r.label}` : ''}.`,
      };
    },
    async nearestAirport() {
      const c = tools.context().center;
      if (!c) return { reply: NOT_AVAILABLE };
      const a = (
        await tools.getJson(
          `/api/airports/nearest?lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}&limit=1&types=large_airport,medium_airport,small_airport`,
        )
      )?.airports?.[0];
      if (!a) return { reply: NOT_AVAILABLE };
      return {
        reply: `Nearest airport to the map center: ${a.name} (${a.icao || a.ident}), ${a.distanceNm.toFixed(1)} nm ${cardinal(a.bearingDeg)}. Source: OurAirports.`,
        speech: `The nearest airport is ${a.name}, ${a.distanceNm.toFixed(1)} nautical miles ${cardinal(a.bearingDeg)}.`,
      };
    },
    async whatsThatPlane() {
      return aircraftReply(tools.selectedAircraft() || tools.trackedAircraft());
    },
    async weather(slots) {
      const point = await resolvePoint(slots);
      if (!point)
        return {
          reply: slots.place
            ? `I couldn't find “${slots.place}”.`
            : NOT_AVAILABLE,
        };
      const [wx, nws] = await Promise.all([
        tools
          .getJson(
            `/api/avwx/nearest?lat=${point.lat.toFixed(4)}&lon=${point.lon.toFixed(4)}&limit=1`,
          )
          .catch(() => null),
        tools
          .getJson(
            `/api/nws/alerts?lat=${point.lat.toFixed(4)}&lon=${point.lon.toFixed(4)}`,
          )
          .catch(() => null),
      ]);
      const m = wx?.metars?.[0];
      const alerts = Array.isArray(nws?.alerts) ? nws.alerts : [];
      if (!m && !alerts.length) return { reply: NOT_AVAILABLE };
      const lines = [];
      if (m)
        lines.push(
          `${m.station} (${m.distanceNm < 1 ? 'at' : `${m.distanceNm?.toFixed?.(0) ?? '?'} nm from`} ${point.label}), observed ${ageText(m.ageMs)}${m.stale ? ' — STALE' : ''}: ${m.summary}.${m.flightCategory || m.computedFlightCategory ? ` ${m.flightCategory || m.computedFlightCategory}.` : ''}`,
        );
      if (alerts.length)
        lines.push(
          `NWS: ${alerts
            .slice(0, 3)
            .map((a) => a.event)
            .join(
              ', ',
            )}${alerts.length > 3 ? ` and ${alerts.length - 3} more` : ''} in effect here.`,
        );
      else if (nws) lines.push('No NWS alerts in effect at this point.');
      return { reply: lines.join(' ') };
    },
    async severeWeather() {
      const r = await tools.run('set_layer_visibility', {
        layerId: 'nws-warnings',
        enabled: true,
      });
      const box = tools.context().viewBox;
      const body = box
        ? await tools
            .getJson(
              `/api/nws/alerts?lamin=${box.south.toFixed(3)}&lomin=${box.west.toFixed(3)}&lamax=${box.north.toFixed(3)}&lomax=${box.east.toFixed(3)}`,
            )
            .catch(() => null)
        : null;
      const alerts = Array.isArray(body?.alerts) ? body.alerts : null;
      if (!alerts)
        return {
          reply: `Weather warnings ${r?.ok === false ? 'could not be turned on' : 'on'}. ${NOT_AVAILABLE}`,
        };
      const counts = new Map();
      for (const a of alerts)
        counts.set(a.event, (counts.get(a.event) || 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      return {
        reply: alerts.length
          ? `Weather warnings on. In view (NWS, updated ${ageText(body.ageMs)}): ${top.map(([e, n]) => `${n} ${e}${n > 1 ? 's' : ''}`).join(', ')}.`
          : `Weather warnings on. No NWS warning areas in view (US only), updated ${ageText(body.ageMs)}.`,
      };
    },
    async camerasNear(slots) {
      const point = await resolvePoint(slots);
      if (!point) return { reply: `I couldn't find “${slots.place}”.` };
      const on = await tools.run('set_layer_visibility', {
        layerId: 'cctv',
        enabled: true,
      });
      if (on?.ok === false) return { reply: layerFailure(on, 'cctv', true) };
      const near = tools.camerasNear(point, 50);
      if (!near.within.length) {
        const far = near.nearest
          ? ` The nearest camera in the app is ${near.nearest.name}, ${Math.round(near.nearest.km).toLocaleString('en-US')} km away.`
          : '';
        return {
          reply: `No traffic cameras within 50 km of ${point.label} in the connected camera sources.${far}`,
        };
      }
      const target = near.within[0];
      let r = await tools.run('control_cctv', {
        action: 'select',
        cameraQuery: target.name,
      });
      if (r?.ok === false)
        r = await tools.run('control_cctv', { action: 'nearest' });
      const shown = r?.activeCamera?.name || r?.activeCamera || target.name;
      const km = near.within.find((c) => c.name === shown)?.km;
      return {
        reply: `${near.within.length} camera${near.within.length === 1 ? '' : 's'} within 50 km of ${point.label}. Showing ${shown}${Number.isFinite(km) ? ` (${km.toFixed(1)} km)` : ''}.`,
      };
    },
    async atcFrequency() {
      const q = tools.frequencyQuery();
      if (!q) {
        const airport = await nearestAirportDetail();
        if (!airport) return { reply: NOT_AVAILABLE };
        const pick = (types) =>
          airport.frequencies?.find((f) => types.includes(f.type));
        const list = [
          ['Tower', pick(['TWR'])],
          ['Ground', pick(['GND'])],
          ['Approach', pick(['APP', 'A/D', 'DEP'])],
          ['ATIS', pick(['ATIS'])],
          ['CTAF', pick(['CTAF'])],
        ].filter(
          ([, f], i, all) =>
            f && all.findIndex(([, g]) => g?.mhz === f.mhz) === i,
        );
        if (!list.length)
          return {
            reply: `${airport.name} has no frequencies listed in OurAirports.`,
          };
        return {
          reply: `No aircraft is tracked, so here is the nearest airport, ${airport.icao || airport.ident}: ${list.map(([n, f]) => `${n} ${f.mhz}`).join(', ')} (OurAirports). Track an aircraft for an estimate based on its phase of flight.`,
        };
      }
      const f = await tools
        .getJson(`/api/airports/frequency?${q}`)
        .catch(() => null);
      if (!f?.frequencyMHz) return { reply: f?.reason || NOT_AVAILABLE };
      return {
        reply: `${f.reason}. Estimated from position; OurAirports frequency data.`,
        speech: `${f.facilityName || f.facility} ${f.airport?.icao || f.airport?.ident}, ${String(f.frequencyMHz).split('').join(' ').replace('.', 'point')}. Estimated.`,
      };
    },
    async openAtcSource() {
      const q = tools.frequencyQuery();
      const f = q
        ? await tools.getJson(`/api/airports/frequency?${q}`).catch(() => null)
        : null;
      const icao =
        f?.airport?.icao ||
        f?.airport?.ident ||
        (await nearestAirportDetail())?.icao ||
        null;
      const sources = tools.audioSources({
        airportIcao: icao,
        frequencyMHz: f?.frequencyMHz ?? null,
      });
      const best = sources[0];
      if (!best)
        return {
          reply:
            'No ATC audio source for this area. Add your own receiver under SOURCES on the cockpit ATC page.',
        };
      if (best.embeddable) {
        tools.playAudio(best);
        return {
          reply: `Playing ${best.label} (${best.credit}). LIVE shows only when audio is actually heard.`,
        };
      }
      const opened = tools.openExternal(best.url);
      return {
        reply: opened
          ? `Opened ${best.label} in a new tab. It's an external source; the app never embeds or re-streams it.`
          : `Your browser blocked the new tab. Open ${best.url} or use LISTEN ON EXTERNAL SOURCE on the cockpit ATC page.`,
      };
    },
    async toggleLayer({ layerId, enabled }) {
      const want = enabled ?? !tools.layerEnabled(layerId);
      const r = await tools.run('set_layer_visibility', {
        layerId,
        enabled: want,
      });
      if (r?.ok === false) return { reply: layerFailure(r, layerId, want) };
      return { reply: `${r?.label || layerId} ${want ? 'on' : 'off'}.` };
    },
  };

  async function tier2(text) {
    const status = await tools.getJson('/api/god/status').catch(() => null);
    if (!status?.configured) return { reply: AI_NOT_CONFIGURED, tier: 2 };
    const ctx = tools.context();
    const messages = [
      {
        role: 'user',
        content: `${text}\n\n[Current app state as of now: ${JSON.stringify(tools.describeContext(ctx))}]`,
      },
    ];
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await fetchImpl('/api/god/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: GOD_SYSTEM_RULES,
          messages,
          tools: tools.definitions(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        return {
          reply: body?.error || 'The AI assistant is unavailable right now.',
          tier: 2,
        };
      debug({ kind: 'model', text: body.text, toolCalls: body.toolCalls });
      if (!body.toolCalls?.length)
        return { reply: body.text?.trim() || NOT_AVAILABLE, tier: 2 };
      messages.push({
        role: 'assistant',
        content: body.text || '',
        toolCalls: body.toolCalls,
      });
      for (const call of body.toolCalls) {
        let result;
        try {
          result = await tools.callTool(call.name, call.args || {});
        } catch (error) {
          result = { ok: false, error: error?.message || 'tool failed' };
        }
        debug({ kind: 'tool', name: call.name, args: call.args, result });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(result).slice(0, 12_000),
        });
      }
    }
    return { reply: NOT_AVAILABLE, tier: 2 };
  }

  return {
    /** @param {string} text */
    async handle(text) {
      const command = parseCommand(text, { layers: tools.layers() });
      debug({ kind: 'input', text, parsed: command });
      if (!command) return tier2(text);
      const handler = handlers[command.intent];
      const result = await handler(command);
      debug({ kind: 'reply', intent: command.intent, reply: result.reply });
      return { ...result, tier: 1, intent: command.intent };
    },
  };
}
