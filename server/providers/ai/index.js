/**
 * Optional AI tier for GOD (GODS-EYE-VIEW-SPEC v2, 4.19 / "Speech and AI").
 * A provider-agnostic AIProvider behind the gateway: the key never reaches
 * the browser. The browser runs the tool loop (tools are app actions); this
 * route only relays one model turn at a time in a common shape:
 *
 *   request  { system, messages: [{ role: 'user'|'assistant'|'tool', content, toolCalls?, toolCallId?, name? }], tools: [{ name, description, parameters }] }
 *   response { text, toolCalls: [{ id, name, args }] }
 *
 * AI_PROVIDER = anthropic (Messages API) | openai (Chat Completions)
 * AI_API_KEY  = your key          AI_MODEL = model id
 */

import { readRequestBodyCapped } from '../common/request.js';
import { createBudget } from '../gateway/budget.js';
import { PROVIDER_CATALOG } from '../gateway/catalog.js';
import { providerRegistry } from '../gateway/registry.js';
import { isLocalRequest } from '../whisper/index.js';

export const AI_DEFAULT_MODELS = Object.freeze({
  anthropic: 'claude-sonnet-5-5',
});
const TIMEOUT_MS = 60_000;
const MAX_BODY = 512 * 1024;

export function resolveAiConfig(env = process.env) {
  const provider =
    String(env.AI_PROVIDER || '')
      .trim()
      .toLowerCase() || (env.AI_API_KEY ? 'anthropic' : '');
  const key = String(env.AI_API_KEY || '').trim();
  if (!key) return { configured: false, problem: 'AI_API_KEY is not set' };
  if (!['anthropic', 'openai'].includes(provider))
    return {
      configured: false,
      problem: 'AI_PROVIDER must be anthropic or openai',
    };
  const model =
    String(env.AI_MODEL || '').trim() || AI_DEFAULT_MODELS[provider] || '';
  if (!model)
    return { configured: false, problem: 'Set AI_MODEL for this provider' };
  return { configured: true, provider, key, model };
}

/** Common request → Anthropic Messages body. */
export function toAnthropic({ system, messages, tools }, model) {
  const out = [];
  for (const m of messages || []) {
    if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: String(m.content ?? ''),
      };
      const last = out[out.length - 1];
      if (
        last?.role === 'user' &&
        Array.isArray(last.content) &&
        last.content[0]?.type === 'tool_result'
      )
        last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.toolCalls.map((c) => ({
            type: 'tool_use',
            id: c.id,
            name: c.name,
            input: c.args || {},
          })),
        ],
      });
    } else
      out.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content ?? ''),
      });
  }
  return {
    model,
    max_tokens: 1024,
    system,
    messages: out,
    tools: (tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    })),
  };
}

export function fromAnthropic(body) {
  const blocks = Array.isArray(body?.content) ? body.content : [];
  return {
    text: blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim(),
    toolCalls: blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
  };
}

/** Common request → OpenAI Chat Completions body. */
export function toOpenAi({ system, messages, tools }, model) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages || []) {
    if (m.role === 'tool')
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: String(m.content ?? ''),
      });
    else if (m.role === 'assistant' && m.toolCalls?.length)
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        })),
      });
    else
      out.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content ?? ''),
      });
  }
  return {
    model,
    messages: out,
    tools: (tools || []).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })),
  };
}

export function fromOpenAi(body) {
  const msg = body?.choices?.[0]?.message || {};
  return {
    text: String(msg.content || '').trim(),
    toolCalls: (msg.tool_calls || []).map((c) => {
      let args = {};
      try {
        args = JSON.parse(c.function?.arguments || '{}');
      } catch {
        args = {};
      }
      return { id: c.id, name: c.function?.name, args };
    }),
  };
}

/**
 * @param {{ env?: Record<string,string|undefined>, fetchImpl?: typeof fetch, now?: () => number, registry?: typeof providerRegistry }} [options]
 */
export function createAiService({
  env = process.env,
  fetchImpl = (i, n) => globalThis.fetch(i, n),
  now = Date.now,
  registry = providerRegistry,
} = {}) {
  const budget = createBudget({ perMinute: 20, dailyCredits: 500, now });
  const provider = registry.register(PROVIDER_CATALOG['ai-assistant'], {
    budget,
    configured: () => resolveAiConfig(env).configured,
  });

  function status() {
    const c = resolveAiConfig(env);
    return {
      configured: c.configured,
      provider: c.provider || null,
      model: c.model || null,
      message: c.problem || null,
    };
  }

  async function chat(request) {
    const c = resolveAiConfig(env);
    if (!c.configured)
      return {
        status: 503,
        body: {
          error:
            'AI assistant not configured — add an AI key in Settings → AI.',
          code: 'NOT_CONFIGURED',
        },
      };
    if (!Array.isArray(request?.messages) || !request.messages.length)
      return { status: 400, body: { error: 'messages required' } };
    try {
      const result = await budget.run(`chat:${now()}`, async () => {
        const started = now();
        const anthropic = c.provider === 'anthropic';
        const response = await fetchImpl(
          anthropic
            ? 'https://api.anthropic.com/v1/messages'
            : 'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: anthropic
              ? {
                  'content-type': 'application/json',
                  'x-api-key': c.key,
                  'anthropic-version': '2023-06-01',
                }
              : {
                  'content-type': 'application/json',
                  authorization: `Bearer ${c.key}`,
                },
            body: JSON.stringify(
              anthropic
                ? toAnthropic(request, c.model)
                : toOpenAi(request, c.model),
            ),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const error = new Error(
            body?.error?.message || `AI provider answered ${response.status}`,
          );
          Object.assign(error, { status: response.status });
          throw error;
        }
        provider.success({ latencyMs: now() - started });
        return anthropic ? fromAnthropic(body) : fromOpenAi(body);
      });
      return { status: 200, body: result };
    } catch (error) {
      provider.failure(error);
      return {
        status: 502,
        body: {
          error: `AI assistant unavailable: ${error?.message || 'error'}`,
        },
      };
    }
  }

  return { status, chat };
}

/** Vite plugin: mount /api/god. */
export function aiProxy(options) {
  let service = null;
  const install = (server) => {
    service ||= createAiService(options);
    server.middlewares.use('/api/god', async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(body));
      };
      if (!isLocalRequest(req))
        return send(403, { error: 'GOD is available on this Mac only' });
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      try {
        if (req.method === 'GET' && path === '/status')
          return send(200, service.status());
        if (req.method === 'POST' && path === '/chat') {
          const raw = await readRequestBodyCapped(req, MAX_BODY);
          const r = await service.chat(JSON.parse(raw.toString('utf8')));
          return send(r.status, r.body);
        }
        return send(404, { error: 'Not found' });
      } catch {
        return send(400, { error: 'Bad request' });
      }
    });
  };
  return {
    name: 'gev-ai',
    configureServer: install,
    configurePreviewServer: install,
  };
}
