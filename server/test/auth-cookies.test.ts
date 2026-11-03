import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearCookie, readCookie, serializeCookie } from '../src/auth/cookies.js';

test('cookie parser reads a named cookie without confusing similar names', () => {
  assert.equal(readCookie('other=value; nexus_session=abc_123; nexus_session_old=old', 'nexus_session'), 'abc_123');
  assert.equal(readCookie('nexus_session_old=old', 'nexus_session'), undefined);
});

test('cookie parser safely decodes values and rejects malformed encoding', () => {
  assert.equal(readCookie('nexus_session=hello%20world', 'nexus_session'), 'hello world');
  assert.equal(readCookie('nexus_session=%E0%A4%A', 'nexus_session'), undefined);
});

test('session cookies are HttpOnly, SameSite=Lax and Secure when configured', () => {
  const cookie = serializeCookie('nexus_session', 'opaque-token', { maxAgeSeconds: 3600, secure: true });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=3600/);
  assert.doesNotMatch(cookie, /Domain=/);
});

test('cookie clearing uses a zero max age', () => {
  assert.match(clearCookie('nexus_session', true), /Max-Age=0/);
});
