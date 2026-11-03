import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvitationToken, hashInvitationToken } from '../src/auth/invitations.js';

test('invitation token is a 256-bit base64url secret and stores only a SHA-256 digest', () => {
  const invitation = createInvitationToken();

  assert.match(invitation.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(invitation.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(invitation.tokenHash, hashInvitationToken(invitation.token));
  assert.notEqual(invitation.tokenHash, invitation.token);
});

test('different invitation tokens produce different digests', () => {
  const first = createInvitationToken();
  const second = createInvitationToken();

  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenHash, second.tokenHash);
});

test('token hashing is deterministic for a supplied token', () => {
  assert.equal(hashInvitationToken('fixed-test-token'), hashInvitationToken('fixed-test-token'));
  assert.notEqual(hashInvitationToken('fixed-test-token'), hashInvitationToken('another-token'));
});
