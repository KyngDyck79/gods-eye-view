import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  MAX_RELAYS,
  createAudioRelay,
  validateLocalStreamUrl,
} from '../../server/providers/audio/relay.js';

/** A stand-in receiver on 127.0.0.1 with an audio mount and some traps. */
async function fakeReceiver() {
  const open = new Set();
  const server = http.createServer((req, res) => {
    if (req.url === '/kmyr') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.write(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
      open.add(res);
      req.on('close', () => open.delete(res));
      return;
    }
    if (req.url === '/admin') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<h1>router admin</h1>');
    }
    if (req.url === '/moved') {
      res.writeHead(302, { Location: 'http://example.com/stream' });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, server, open };
}

/** A relay mounted on its own local server, returning a fetch helper. */
async function relayServer() {
  const relay = createAudioRelay();
  const server = http.createServer((req, res) => relay.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const get = (streamUrl, init) =>
    fetch(`http://127.0.0.1:${port}/api/audio/relay?url=${encodeURIComponent(streamUrl)}`, init);
  return { relay, server, get };
}

test('only streams on your own network are accepted', () => {
  assert.equal(validateLocalStreamUrl('http://192.168.1.20:8000/kmyr').ok, true);
  assert.equal(validateLocalStreamUrl('http://airband.local:8000/kmyr').ok, true);
  assert.equal(validateLocalStreamUrl('http://127.0.0.1:8000/kmyr').ok, true);
  assert.equal(validateLocalStreamUrl('https://s1-bos.liveatc.net/kmyr').ok, false);
  assert.equal(validateLocalStreamUrl('http://8.8.8.8/x').ok, false);
  assert.equal(validateLocalStreamUrl('http://user:pw@192.168.1.20/x').ok, false);
  assert.equal(validateLocalStreamUrl('file:///etc/passwd').ok, false);
});

test('an audio mount on the local network is relayed as a stream', async (t) => {
  const receiver = await fakeReceiver();
  const { server, get, relay } = await relayServer();
  t.after(() => {
    server.close();
    receiver.server.close();
  });
  const controller = new AbortController();
  const response = await get(`${receiver.base}/kmyr`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('access-control-allow-origin'), null, 'no CORS: other sites cannot read it');
  const reader = response.body.getReader();
  const { value } = await reader.read();
  assert.deepEqual([...value], [0xff, 0xfb, 0x90, 0x00]);
  assert.equal(relay.activeCount(), 1);
  controller.abort();
  // Closing the listener closes the upstream connection too.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(relay.activeCount(), 0);
  assert.equal(receiver.open.size, 0);
});

test('non-audio responses and redirects are refused, public hosts never contacted', async (t) => {
  const receiver = await fakeReceiver();
  const { server, get } = await relayServer();
  t.after(() => {
    server.close();
    receiver.server.close();
  });
  assert.equal((await get(`${receiver.base}/admin`)).status, 502);
  const moved = await get(`${receiver.base}/moved`);
  assert.equal(moved.status, 502);
  assert.equal((await moved.json()).error, 'Redirects are not followed');
  const external = await get('https://www.liveatc.net/hlisten.php?mount=kmyr');
  assert.equal(external.status, 400);
  assert.match((await external.json()).error, /own network/);
});

test(`at most ${MAX_RELAYS} streams at once`, async (t) => {
  const receiver = await fakeReceiver();
  const { server, get } = await relayServer();
  t.after(() => {
    server.close();
    receiver.server.close();
  });
  const controllers = [];
  for (let i = 0; i < MAX_RELAYS; i += 1) {
    const controller = new AbortController();
    controllers.push(controller);
    assert.equal((await get(`${receiver.base}/kmyr`, { signal: controller.signal })).status, 200);
  }
  assert.equal((await get(`${receiver.base}/kmyr`)).status, 429);
  controllers.forEach((c) => c.abort());
});

test('a receiver that is off gives the unavailable message', async (t) => {
  const { server, get } = await relayServer();
  t.after(() => server.close());
  const response = await get('http://127.0.0.1:1/kmyr');
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'AUDIO SOURCE UNAVAILABLE');
});
