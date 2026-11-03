import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenVault } from '../src/security/token-vault.js';

const key = Buffer.alloc(32, 7);

test('token vault encrypts and decrypts a provider token', () => {
  const vault = createTokenVault(key);
  const encrypted = vault.encrypt('provider-access-token', 'connection:123:access');
  assert.notEqual(encrypted.ciphertext, 'provider-access-token');
  assert.equal(vault.decrypt(encrypted, 'connection:123:access'), 'provider-access-token');
});

test('token vault uses a fresh IV for every encryption', () => {
  const vault = createTokenVault(key);
  const first = vault.encrypt('same-token', 'connection:123:access');
  const second = vault.encrypt('same-token', 'connection:123:access');
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test('token vault rejects tampering and purpose substitution', () => {
  const vault = createTokenVault(key);
  const encrypted = vault.encrypt('provider-refresh-token', 'connection:123:refresh');
  assert.throws(() => vault.decrypt({ ...encrypted, ciphertext: Buffer.from('tampered').toString('base64') }, 'connection:123:refresh'));
  assert.throws(() => vault.decrypt(encrypted, 'connection:456:refresh'));
});

test('token vault rejects keys that are not exactly 32 bytes', () => {
  assert.throws(() => createTokenVault(Buffer.alloc(16)));
});
