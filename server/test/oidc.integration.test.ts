import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { EncryptedSecret } from '../src/security/token-vault.js';

type TokenMode = 'valid' | 'wrong_nonce' | 'expired' | 'wrong_audience';
type StoredLoginTransaction = {
  nonce_hash: string;
  code_verifier_envelope: EncryptedSecret;
  expires_at: number;
};
type StoredSession = {
  id: string;
  session_hash: string;
  user_id: string;
  issuer: string;
  email: string | null;
  email_verified: boolean;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};
type StoredCode = {
  challenge: string;
  nonce: string;
  clientId: string;
  redirectUri: string;
  mode: TokenMode;
  used: boolean;
};

function result<T extends QueryResultRow>(rows: T[] = [], rowCount = rows.length): QueryResult<T> {
  return { command: '', rowCount, oid: 0, fields: [], rows };
}

/**
 * A deterministic PostgreSQL test double. Fastify routes, OIDC discovery,
 * token exchange, PKCE checks and JWKS signature verification remain real.
 */
class AuthTestPool {
  readonly loginTransactions = new Map<string, StoredLoginTransaction>();
  readonly sessions = new Map<string, StoredSession>();
  readonly securityEvents: Array<{ userId: string; sessionId?: string; type: string }> = [];

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = []
  ): Promise<QueryResult<T>> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('begin') || normalized.startsWith('commit') || normalized.startsWith('rollback')) {
      return result<T>([], 0);
    }

    if (normalized.startsWith('delete from public.auth_login_transactions where expires_at <= now()')) {
      const now = Date.now();
      for (const [stateHash, transaction] of this.loginTransactions) {
        if (transaction.expires_at <= now) this.loginTransactions.delete(stateHash);
      }
      return result<T>([], 0);
    }

    if (normalized.startsWith('insert into public.auth_login_transactions')) {
      const [stateHash, nonceHash, envelope] = values as [string, string, string];
      this.loginTransactions.set(stateHash, {
        nonce_hash: nonceHash,
        code_verifier_envelope: typeof envelope === 'string' ? JSON.parse(envelope) as EncryptedSecret : envelope as EncryptedSecret,
        expires_at: Date.now() + 10 * 60 * 1000
      });
      return result<T>([], 1);
    }

    if (normalized.startsWith('delete from public.auth_login_transactions where state_hash = $1')) {
      const stateHash = values[0] as string;
      const transaction = this.loginTransactions.get(stateHash);
      if (!transaction || transaction.expires_at <= Date.now()) return result<T>([], 0);
      this.loginTransactions.delete(stateHash);
      return result<T>([{
        nonce_hash: transaction.nonce_hash,
        code_verifier_envelope: transaction.code_verifier_envelope
      } as unknown as T], 1);
    }

    if (normalized.startsWith('insert into public.auth_sessions')) {
      const [sessionHash, userId, issuer, email, emailVerified, _userAgent, ttl] = values as [
        string, string, string, string | null, boolean, string | null, number
      ];
      const now = new Date();
      const session: StoredSession = {
        id: randomUUID(),
        session_hash: sessionHash,
        user_id: userId,
        issuer,
        email,
        email_verified: emailVerified,
        created_at: now,
        last_seen_at: now,
        expires_at: new Date(now.getTime() + ttl * 1000),
        revoked_at: null
      };
      this.sessions.set(session.id, session);
      return result<T>([{ id: session.id, expires_at: session.expires_at } as unknown as T], 1);
    }

    if (normalized.startsWith('select id, user_id, issuer, email, email_verified, expires_at from public.auth_sessions')) {
      const hash = values[0] as string;
      const session = [...this.sessions.values()].find(item =>
        item.session_hash === hash && item.revoked_at === null && item.expires_at.getTime() > Date.now()
      );
      if (!session) return result<T>([], 0);
      return result<T>([{
        id: session.id,
        user_id: session.user_id,
        issuer: session.issuer,
        email: session.email,
        email_verified: session.email_verified,
        expires_at: session.expires_at
      } as unknown as T], 1);
    }

    if (normalized.startsWith('update public.auth_sessions set last_seen_at = now()')) {
      const session = this.sessions.get(values[0] as string);
      if (session) session.last_seen_at = new Date();
      return result<T>([], session ? 1 : 0);
    }

    if (normalized.startsWith('select id, created_at, last_seen_at, expires_at from public.auth_sessions')) {
      const userId = values[0] as string;
      const active = [...this.sessions.values()]
        .filter(item => item.user_id === userId && item.revoked_at === null && item.expires_at.getTime() > Date.now())
        .sort((left, right) => right.last_seen_at.getTime() - left.last_seen_at.getTime())
        .slice(0, 50)
        .map(item => ({
          id: item.id,
          created_at: item.created_at,
          last_seen_at: item.last_seen_at,
          expires_at: item.expires_at
        }));
      return result<T>(active as unknown as T[], active.length);
    }

    if (normalized.startsWith('update public.auth_sessions set revoked_at = now() where id = $1::uuid and user_id = $2 and revoked_at is null returning id')) {
      const session = this.sessions.get(values[0] as string);
      if (!session || session.user_id !== values[1] || session.revoked_at) return result<T>([], 0);
      session.revoked_at = new Date();
      return result<T>([{ id: session.id } as unknown as T], 1);
    }

    if (normalized.startsWith('update public.auth_sessions set revoked_at = now() where id = $1::uuid and user_id = $2 and revoked_at is null')) {
      const session = this.sessions.get(values[0] as string);
      if (session && session.user_id === values[1] && !session.revoked_at) session.revoked_at = new Date();
      return result<T>([], session ? 1 : 0);
    }

    if (normalized.startsWith('update public.auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null and expires_at > now() returning id')) {
      const userId = values[0] as string;
      const revoked: Array<{ id: string }> = [];
      for (const session of this.sessions.values()) {
        if (session.user_id === userId && !session.revoked_at && session.expires_at.getTime() > Date.now()) {
          session.revoked_at = new Date();
          revoked.push({ id: session.id });
        }
      }
      return result<T>(revoked as unknown as T[], revoked.length);
    }

    if (normalized.startsWith('insert into public.auth_security_events')) {
      const typeMatch = normalized.match(/'((?:login|logout|session|sessions)(?:\.[a-z.]+)?)'/);
      this.securityEvents.push({
        userId: String(values[0] ?? ''),
        sessionId: typeof values[1] === 'string' && values[1].includes('-') ? values[1] : undefined,
        type: typeMatch?.[1] ?? 'unknown'
      });
      return result<T>([], 1);
    }

    throw new Error('Unexpected SQL in OIDC integration test: ' + normalized);
  }

  async connect() {
    return {
      query: <T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) => this.query<T>(sql, values),
      release: () => undefined
    };
  }

  async end(): Promise<void> {
    // No external database connection is held by this test double.
  }
}

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readRequestBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function firstCookie(value: string | string[] | undefined): string {
  const item = Array.isArray(value) ? value[0] : value;
  assert.ok(item, 'Expected a Set-Cookie header.');
  return item;
}

function cookiePair(value: string): string {
  return value.split(';', 1)[0] ?? '';
}

function errorCode(response: { json: () => unknown }): string | undefined {
  return (response.json() as { error?: { code?: string } }).error?.code;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function createFixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const kid = randomBytes(8).toString('hex');
  const publicJwk = await exportJWK(publicKey);
  const jwks = { keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' } as JWK] };
  const authorizationCodes = new Map<string, StoredCode>();
  let nextTokenMode: TokenMode = 'valid';
  let tokenRequests = 0;
  let issuer = '';

  const provider = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? '/', issuer);

      if (request.method === 'GET' && requestUrl.pathname === '/.well-known/openid-configuration') {
        sendJson(response, 200, {
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token'
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/jwks') {
        sendJson(response, 200, jwks);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/authorize') {
        const state = requestUrl.searchParams.get('state') ?? '';
        const nonce = requestUrl.searchParams.get('nonce') ?? '';
        const clientId = requestUrl.searchParams.get('client_id') ?? '';
        const redirectUri = requestUrl.searchParams.get('redirect_uri') ?? '';
        const challenge = requestUrl.searchParams.get('code_challenge') ?? '';
        const method = requestUrl.searchParams.get('code_challenge_method');

        if (
          requestUrl.searchParams.get('response_type') !== 'code' ||
          method !== 'S256' ||
          !/^[A-Za-z0-9_-]{43}$/.test(state) ||
          !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
          !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
          clientId !== 'nexus-test-client' ||
          !redirectUri
        ) {
          sendJson(response, 400, { error: 'invalid_authorization_request' });
          return;
        }

        const code = randomBytes(18).toString('base64url');
        authorizationCodes.set(code, {
          challenge,
          nonce,
          clientId,
          redirectUri,
          mode: nextTokenMode,
          used: false
        });
        nextTokenMode = 'valid';

        const callback = new URL(redirectUri);
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', state);
        response.writeHead(302, { location: callback.toString(), 'cache-control': 'no-store' });
        response.end();
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/token') {
        tokenRequests += 1;
        const parameters = new URLSearchParams(await readRequestBody(request));
        const code = parameters.get('code') ?? '';
        const authorizationCode = authorizationCodes.get(code);
        const verifier = parameters.get('code_verifier') ?? '';
        const computedChallenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');

        if (
          parameters.get('grant_type') !== 'authorization_code' ||
          !authorizationCode ||
          authorizationCode.used ||
          parameters.get('client_id') !== authorizationCode.clientId ||
          parameters.get('redirect_uri') !== authorizationCode.redirectUri ||
          computedChallenge !== authorizationCode.challenge
        ) {
          sendJson(response, 400, { error: 'invalid_grant' });
          return;
        }

        authorizationCode.used = true;
        const nonce = authorizationCode.mode === 'wrong_nonce'
          ? authorizationCode.nonce + '-not-the-issued-nonce'
          : authorizationCode.nonce;
        const token = await new SignJWT({
          nonce,
          email: 'oidc.user@example.test',
          email_verified: true
        })
          .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
          .setIssuer(issuer)
          .setAudience(authorizationCode.mode === 'wrong_audience' ? 'another-client' : authorizationCode.clientId)
          .setSubject('mock-oidc-user-001')
          .setIssuedAt()
          .setExpirationTime(authorizationCode.mode === 'expired' ? Math.floor(Date.now() / 1000) - 60 : '5m')
          .sign(privateKey);

        sendJson(response, 200, { access_token: 'mock-access-token', token_type: 'Bearer', expires_in: 300, id_token: token });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    })().catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'mock_provider_error' });
      else response.destroy();
    });
  });

  const port = await listen(provider);
  issuer = 'http://127.0.0.1:' + port;
  const pool = new AuthTestPool();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://nexus_app:test-only@127.0.0.1:5432/nexus',
    CORS_ORIGINS: 'http://localhost:5173',
    AUTH_FRONTEND_URL: 'http://localhost:5173',
    OIDC_ISSUER_URL: issuer,
    OIDC_AUDIENCE: 'nexus-api',
    OIDC_JWKS_URL: issuer + '/jwks',
    OIDC_CLIENT_ID: 'nexus-test-client',
    OIDC_CLIENT_AUTH_METHOD: 'none',
    OIDC_REDIRECT_URI: 'http://localhost:8787/api/v1/auth/oidc/callback',
    SESSION_COOKIE_SECURE: 'false',
    AUTH_SESSION_TTL_SECONDS: '3600',
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString('base64')
  });

  const app = await buildApp(config, pool as unknown as Pool);
  await app.ready();

  return {
    app,
    provider,
    pool,
    issuer,
    setNextTokenMode(mode: TokenMode) {
      nextTokenMode = mode;
    },
    getTokenRequestCount() {
      return tokenRequests;
    },
    async dispose() {
      await app.close();
      await close(provider);
    }
  };
}

async function completeAuthorization(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  options: { tamperChallenge?: boolean } = {}
) {
  const start = await fixture.app.inject({ method: 'GET', url: '/api/v1/auth/oidc/start' });
  assert.equal(start.statusCode, 302, start.body);

  const stateSetCookie = firstCookie(start.headers['set-cookie']);
  const stateCookie = cookiePair(stateSetCookie);
  const authorizationUrl = new URL(start.headers.location as string);
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');

  if (options.tamperChallenge) authorizationUrl.searchParams.set('code_challenge', 'A'.repeat(43));

  const authorizationResponse = await fetch(authorizationUrl, { redirect: 'manual' });
  assert.equal(authorizationResponse.status, 302);
  const callbackUrl = new URL(authorizationResponse.headers.get('location') ?? '');
  return { stateSetCookie, stateCookie, callbackUrl };
}

test('OIDC authorization code + PKCE completes, creates a browser session and logout revokes it', async () => {
  const fixture = await createFixture();
  try {
    const status = await fixture.app.inject({ method: 'GET', url: '/api/v1/auth/oidc/status' });
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.json(), { loginAvailable: true });
    assert.match(status.headers['cache-control'] ?? '', /no-store/);

    const authorization = await completeAuthorization(fixture);
    assert.match(authorization.stateSetCookie, /HttpOnly/);
    assert.match(authorization.stateSetCookie, /SameSite=Lax/);
    assert.match(authorization.stateSetCookie, /Max-Age=600/);

    const callback = await fixture.app.inject({
      method: 'GET',
      url: authorization.callbackUrl.pathname + authorization.callbackUrl.search,
      headers: { cookie: authorization.stateCookie }
    });
    assert.equal(callback.statusCode, 302, callback.body);
    assert.equal(new URL(callback.headers.location as string).searchParams.get('auth'), 'success');

    const cookies = Array.isArray(callback.headers['set-cookie'])
      ? callback.headers['set-cookie']
      : [callback.headers['set-cookie']];
    const sessionSetCookie = cookies.find(value => typeof value === 'string' && value.startsWith('nexus_session='));
    assert.ok(sessionSetCookie, 'Expected the callback to set the opaque browser session cookie.');
    assert.match(sessionSetCookie, /HttpOnly/);
    assert.match(sessionSetCookie, /SameSite=Lax/);
    assert.match(sessionSetCookie, /Max-Age=3600/);
    assert.doesNotMatch(sessionSetCookie, /Secure/);

    const sessionCookie = cookiePair(sessionSetCookie);
    const rawSessionToken = sessionCookie.slice('nexus_session='.length);
    assert.match(rawSessionToken, /^[A-Za-z0-9_-]{43}$/);
    const storedSession = [...fixture.pool.sessions.values()][0];
    assert.ok(storedSession);
    assert.match(storedSession.session_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(storedSession.session_hash, rawSessionToken);

    const currentSession = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: sessionCookie }
    });
    assert.equal(currentSession.statusCode, 200, currentSession.body);
    assert.deepEqual(currentSession.json(), {
      user: {
        id: 'mock-oidc-user-001',
        email: 'oidc.user@example.test',
        emailVerified: true,
        issuer: fixture.issuer
      },
      authentication: {
        method: 'session',
        expiresAt: storedSession.expires_at.toISOString()
      }
    });

    const sessions = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: sessionCookie }
    });
    assert.equal(sessions.statusCode, 200);
    assert.equal((sessions.json() as { sessions: Array<{ current: boolean }> }).sessions[0]?.current, true);

    const csrfBlocked = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: sessionCookie, origin: 'https://attacker.example' }
    });
    assert.equal(csrfBlocked.statusCode, 403);
    assert.equal(errorCode(csrfBlocked), 'csrf_origin_rejected');

    const logout = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: sessionCookie, origin: 'http://localhost:5173' }
    });
    assert.equal(logout.statusCode, 200, logout.body);
    assert.deepEqual(logout.json(), { loggedOut: true });
    assert.match(firstCookie(logout.headers['set-cookie']), /Max-Age=0/);
    assert.ok(storedSession.revoked_at);
    assert.deepEqual(fixture.pool.securityEvents.map(event => event.type), ['login.succeeded', 'logout']);

    const afterLogout = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: sessionCookie }
    });
    assert.equal(afterLogout.statusCode, 401);
    assert.equal(errorCode(afterLogout), 'session_invalid_or_expired');
  } finally {
    await fixture.dispose();
  }
});

test('OIDC callback rejects a state cookie mismatch before exchanging an authorization code', async () => {
  const fixture = await createFixture();
  try {
    const authorization = await completeAuthorization(fixture);
    const mismatchedCookie = 'nexus_oidc_state=' + 'A'.repeat(43);
    const callback = await fixture.app.inject({
      method: 'GET',
      url: authorization.callbackUrl.pathname + authorization.callbackUrl.search,
      headers: { cookie: mismatchedCookie }
    });

    assert.equal(callback.statusCode, 401);
    assert.equal(errorCode(callback), 'oidc_state_mismatch');
    assert.equal(fixture.getTokenRequestCount(), 0);
    assert.equal(fixture.pool.sessions.size, 0);
  } finally {
    await fixture.dispose();
  }
});

test('OIDC callback rejects a provider ID token with a mismatched nonce', async () => {
  const fixture = await createFixture();
  try {
    fixture.setNextTokenMode('wrong_nonce');
    const authorization = await completeAuthorization(fixture);
    const callback = await fixture.app.inject({
      method: 'GET',
      url: authorization.callbackUrl.pathname + authorization.callbackUrl.search,
      headers: { cookie: authorization.stateCookie }
    });

    assert.equal(callback.statusCode, 401);
    assert.equal(errorCode(callback), 'oidc_identity_invalid');
    assert.equal(fixture.pool.sessions.size, 0);
  } finally {
    await fixture.dispose();
  }
});

test('OIDC callback rejects an expired ID token', async () => {
  const fixture = await createFixture();
  try {
    fixture.setNextTokenMode('expired');
    const authorization = await completeAuthorization(fixture);
    const callback = await fixture.app.inject({
      method: 'GET',
      url: authorization.callbackUrl.pathname + authorization.callbackUrl.search,
      headers: { cookie: authorization.stateCookie }
    });

    assert.equal(callback.statusCode, 401);
    assert.equal(errorCode(callback), 'oidc_identity_invalid');
    assert.equal(fixture.pool.sessions.size, 0);
  } finally {
    await fixture.dispose();
  }
});

test('OIDC callback rejects an ID token with the wrong audience', async () => {
  const fixture = await createFixture();
  try {
    fixture.setNextTokenMode('wrong_audience');
    const authorization = await completeAuthorization(fixture);
    const callback = await fixture.app.inject({
      method: 'GET',
      url: authorization.callbackUrl.pathname + authorization.callbackUrl.search,
      headers: { cookie: authorization.stateCookie }
    });

    assert.equal(callback.statusCode, 401);
    assert.equal(errorCode(callback), 'oidc_identity_invalid');
    assert.equal(fixture.pool.sessions.size, 0);
  } finally {
    await fixture.dispose();
  }
});

test('OIDC callback rejects a PKCE verifier that does not match the authorization challenge', async () => {
  const fixture = await createFixture();
  try {
    const authorization = await completeAuthorization(fixture, { tamperChallenge: true });
    const callback = await fixture.app.inject({
      method: 'GET',
      url: authorization.callbackUrl.pathname + authorization.callbackUrl.search,
      headers: { cookie: authorization.stateCookie }
    });

    assert.equal(callback.statusCode, 401);
    assert.equal(errorCode(callback), 'oidc_token_exchange_rejected');
    assert.equal(fixture.getTokenRequestCount(), 1);
    assert.equal(fixture.pool.sessions.size, 0);
  } finally {
    await fixture.dispose();
  }
});

test('OIDC login transaction and authorization code cannot be replayed', async () => {
  const fixture = await createFixture();
  try {
    const authorization = await completeAuthorization(fixture);
    const callbackUrl = authorization.callbackUrl.pathname + authorization.callbackUrl.search;
    const firstCallback = await fixture.app.inject({
      method: 'GET',
      url: callbackUrl,
      headers: { cookie: authorization.stateCookie }
    });
    assert.equal(firstCallback.statusCode, 302, firstCallback.body);

    const replay = await fixture.app.inject({
      method: 'GET',
      url: callbackUrl,
      headers: { cookie: authorization.stateCookie }
    });
    assert.equal(replay.statusCode, 401);
    assert.equal(errorCode(replay), 'oidc_transaction_expired');
    assert.equal(fixture.pool.sessions.size, 1);
    assert.equal(fixture.getTokenRequestCount(), 1);
  } finally {
    await fixture.dispose();
  }
});
