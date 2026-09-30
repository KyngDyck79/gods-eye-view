import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAiService,
  fromAnthropic,
  fromOpenAi,
  resolveAiConfig,
  toAnthropic,
  toOpenAi,
} from '../../server/providers/ai/index.js';
import { createProviderRegistry } from '../../server/providers/gateway/registry.js';

const request = {
  system: 'rules',
  tools: [{ name: 'getMetar', description: 'metar', parameters: { type: 'object', properties: {} } }],
  messages: [
    { role: 'user', content: 'weather?' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'getMetar', args: { ids: 'KMYR' } }] },
    { role: 'tool', toolCallId: 'c1', name: 'getMetar', content: '{"ok":true}' },
  ],
};

test('config needs a key; anthropic has a default model, openai needs AI_MODEL', () => {
  assert.equal(resolveAiConfig({}).configured, false);
  assert.equal(resolveAiConfig({ AI_API_KEY: 'k' }).model, 'claude-sonnet-5-5');
  assert.match(resolveAiConfig({ AI_API_KEY: 'k', AI_PROVIDER: 'openai' }).problem, /AI_MODEL/);
  assert.equal(resolveAiConfig({ AI_API_KEY: 'k', AI_PROVIDER: 'openai', AI_MODEL: 'm' }).configured, true);
  assert.match(resolveAiConfig({ AI_API_KEY: 'k', AI_PROVIDER: 'other' }).problem, /anthropic or openai/);
});

test('Anthropic Messages shape round-trips tool use', () => {
  const body = toAnthropic(request, 'm');
  assert.equal(body.system, 'rules');
  assert.equal(body.tools[0].input_schema.type, 'object');
  assert.deepEqual(body.messages[1].content[0], { type: 'tool_use', id: 'c1', name: 'getMetar', input: { ids: 'KMYR' } });
  assert.deepEqual(body.messages[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}' }] });
  assert.deepEqual(fromAnthropic({ content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', id: 'x', name: 'n', input: { a: 1 } }] }), {
    text: 'Hi',
    toolCalls: [{ id: 'x', name: 'n', args: { a: 1 } }],
  });
});

test('OpenAI Chat Completions shape round-trips tool calls', () => {
  const body = toOpenAi(request, 'm');
  assert.deepEqual(body.messages[0], { role: 'system', content: 'rules' });
  assert.equal(body.messages[2].tool_calls[0].function.arguments, '{"ids":"KMYR"}');
  assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' });
  assert.equal(body.tools[0].type, 'function');
  assert.deepEqual(fromOpenAi({ choices: [{ message: { content: null, tool_calls: [{ id: 'y', function: { name: 'n', arguments: '{"b":2}' } }] } }] }), {
    text: '',
    toolCalls: [{ id: 'y', name: 'n', args: { b: 2 } }],
  });
});

test('the key goes to the provider only, never back to the browser', async () => {
  let seen;
  const svc = createAiService({
    env: { AI_API_KEY: 'sk-secret', AI_PROVIDER: 'anthropic' },
    registry: createProviderRegistry(),
    fetchImpl: async (url, init) => {
      seen = { url, headers: init.headers };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
    },
  });
  const r = await svc.chat(request);
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.headers['x-api-key'], 'sk-secret');
  assert.equal(seen.headers['anthropic-version'], '2023-06-01');
  assert.doesNotMatch(JSON.stringify(r.body) + JSON.stringify(svc.status()), /sk-secret/);
  const none = createAiService({ env: {}, registry: createProviderRegistry() });
  assert.equal((await none.chat(request)).body.error, 'AI assistant not configured — add an AI key in Settings → AI.');
});
