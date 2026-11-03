import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../src/config.js';
import type { AuthenticatedUser } from '../src/auth/types.js';
import { createAuthenticate } from '../src/auth/middleware.js';
import { AppError } from '../src/errors.js';

const sessionToken = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';

function request(headers: Record<string, string>, method = 'GET') {
  return { headers, method, authUser: null as AuthenticatedUser | null };
}

function config() {
  return { corsOrigins: ['http://localhost:5173'] } as AppConfig;
}

function poolForSession() {
  const calls: string[] = [];
  const pool = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('SELECT id, user_id')) {
        return {
          rows: [{
            id: 'a7ed9eab-b45d-4bca-81b8-b6fa6b1a0d4b',
            user_id: 'oidc-user-1',
            issuer: 'https://identity.example.com',
            email: 'user@example.com',
            email_verified: true,
            expires_at: '2026-11-03T12:00:00.000Z'
          }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    }
  };
  return { pool: pool as unknown as Pool, calls };
}

test('Bearer authentication remains supported without querying browser sessions', async () => {
  const { pool, calls } = poolForSession();
  const verifyToken = async (token: string): Promise<AuthenticatedUser> => {
    assert.equal(token, 'valid-token');
    return { userId: 'bearer-user', issuer: 'https://identity.example.com' };
  };
  const req = request({ authorization: 'Bearer valid-token' });
  const hook = createAuthenticate(verifyToken, pool, config());

  await hook(req as unknown as FastifyRequest, {} as FastifyReply);

  assert.equal(req.authUser?.userId, 'bearer-user');
  assert.equal(req.authUser?.authMethod, 'bearer');
  assert.equal(calls.length, 0);
});

test('browser session authentication revalidates the hash and records the session identity', async () => {
  const { pool, calls } = poolForSession();
  const hook = createAuthenticate(async () => {
    throw new Error('Bearer verifier must not run for cookie auth');
  }, pool, config());
  const req = request({ cookie: 'nexus_session=' + sessionToken }, 'GET');

  await hook(req as unknown as FastifyRequest, {} as FastifyReply);

  assert.equal(req.authUser?.userId, 'oidc-user-1');
  assert.equal(req.authUser?.emailVerified, true);
  assert.equal(req.authUser?.authMethod, 'session');
  assert.equal(req.authUser?.sessionId, 'a7ed9eab-b45d-4bca-81b8-b6fa6b1a0d4b');
  assert.equal(calls.length, 2);
});

test('unsafe cookie-authenticated requests reject an untrusted Origin', async () => {
  const { pool } = poolForSession();
  const hook = createAuthenticate(async () => {
    throw new Error('Bearer verifier must not run for cookie auth');
  }, pool, config());
  const req = request({
    cookie: 'nexus_session=' + sessionToken,
    origin: 'https://attacker.example'
  }, 'POST');

  await assert.rejects(
    () => hook(req as unknown as FastifyRequest, {} as FastifyReply),
    (error: unknown) => error instanceof AppError && error.statusCode === 403 && error.code === 'csrf_origin_rejected'
  );
});

test('an invalid Authorization header does not fall back to a valid session cookie', async () => {
  const { pool, calls } = poolForSession();
  const hook = createAuthenticate(async () => {
    throw new Error('Verifier should not receive a malformed token');
  }, pool, config());
  const req = request({
    authorization: 'Basic invalid',
    cookie: 'nexus_session=' + sessionToken
  });

  await assert.rejects(
    () => hook(req as unknown as FastifyRequest, {} as FastifyReply),
    (error: unknown) => error instanceof AppError && error.statusCode === 401
  );
  assert.equal(calls.length, 0);
});
