import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAccess } from '../../server/providers/common/access.js';

const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers: { host: 'localhost:4173', ...headers } });
const env = { GEV_OWNER_LOGINS: 'Rod@Example.com, other@x.io' };

test('this Mac is the owner', () => {
  assert.deepEqual(requestAccess(req('127.0.0.1'), env), { owner: true, via: 'local' });
  assert.equal(requestAccess(req('::1', { host: '[::1]:4173' }), env).owner, true);
});

test('another device on the network is not', () => {
  assert.equal(requestAccess(req('192.168.12.40'), env).reason, 'remote');
  assert.equal(requestAccess(req('100.101.1.2', { 'tailscale-user-login': 'rod@example.com' }), env).owner, false, 'the header only counts through Serve on loopback');
});

test('through Tailscale Serve only the owner login is served', () => {
  const serve = (login) => req('127.0.0.1', { host: 'mac-mini.tail1234.ts.net', 'tailscale-user-login': login, 'x-forwarded-for': '100.64.0.9' });
  assert.deepEqual(requestAccess(serve('rod@example.com'), env), { owner: true, via: 'tailscale', login: 'rod@example.com' });
  assert.equal(requestAccess(serve('friend@gmail.com'), env).reason, 'not-owner');
  assert.equal(requestAccess(serve('rod@example.com'), {}).owner, false, 'no owner configured, nobody through Serve');
});

test('Funnel, tunnels and foreign hosts are refused', () => {
  assert.equal(requestAccess(req('127.0.0.1', { host: 'mac-mini.tail1234.ts.net' }), env).reason, 'host');
  assert.equal(requestAccess(req('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' }), env).reason, 'proxied');
  assert.equal(requestAccess(req('127.0.0.1', { host: 'evil.example' }), env).reason, 'host');
});
