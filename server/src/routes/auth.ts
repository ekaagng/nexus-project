import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Pool } from 'pg';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { createTokenVault, type EncryptedSecret } from '../security/token-vault.js';
import { clearCookie, OIDC_STATE_COOKIE_NAME, readCookie, serializeCookie, SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { AppError } from '../errors.js';

type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
};

type LoginTransaction = {
  nonce_hash: string;
  code_verifier_envelope: EncryptedSecret;
};

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  error: z.string().max(128).optional()
}).passthrough();

const sessionIdSchema = z.object({
  sessionId: z.string().uuid()
});

function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.authUser) throw new AppError(401, 'authentication_required', 'Authentication is required.');
  return request.authUser;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requireLoginConfig(config: AppConfig): {
  issuer: string;
  clientId: string;
  redirectUri: string;
  encryptionKey: Buffer;
} {
  if (!config.oidcIssuerUrl || !config.oidcClientId || !config.oidcRedirectUri || !config.oidcJwksUrl || !config.encryptionKey) {
    throw new AppError(503, 'oidc_login_not_configured', 'OIDC browser login is not fully configured on this server.');
  }
  if (config.oidcClientAuthMethod !== 'none' && !config.oidcClientSecret) {
    throw new AppError(503, 'oidc_client_secret_missing', 'Configure a client secret or set OIDC_CLIENT_AUTH_METHOD=none for a public PKCE client.');
  }
  return {
    issuer: config.oidcIssuerUrl,
    clientId: config.oidcClientId,
    redirectUri: config.oidcRedirectUri,
    encryptionKey: config.encryptionKey
  };
}

function trustedEndpoint(value: string): URL {
  const endpoint = new URL(value);
  const localHttp = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !localHttp) {
    throw new AppError(503, 'oidc_endpoint_requires_https', 'The identity provider must expose HTTPS endpoints.');
  }
  if (endpoint.username || endpoint.password) {
    throw new AppError(503, 'oidc_endpoint_invalid', 'The identity provider returned an invalid endpoint.');
  }
  return endpoint;
}

async function loadDiscovery(issuer: string): Promise<OidcDiscovery> {
  const discoveryUrl = trustedEndpoint(\`\${issuer.replace(/\\/+$/, '')}/.well-known/openid-configuration\`);
  let response: Response;
  try {
    response = await fetch(discoveryUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new AppError(503, 'oidc_discovery_unavailable', 'The identity provider discovery endpoint is unavailable.');
  }
  if (!response.ok) {
    throw new AppError(503, 'oidc_discovery_unavailable', 'The identity provider discovery endpoint returned an error.');
  }

  let discovery: Partial<OidcDiscovery>;
  try {
    discovery = await response.json() as Partial<OidcDiscovery>;
  } catch {
    throw new AppError(503, 'oidc_discovery_invalid', 'The identity provider discovery response is invalid.');
  }
  if (
    discovery.issuer !== issuer ||
    typeof discovery.authorization_endpoint !== 'string' ||
    typeof discovery.token_endpoint !== 'string'
  ) {
    throw new AppError(503, 'oidc_discovery_invalid', 'The identity provider discovery response does not match the configured issuer.');
  }

  trustedEndpoint(discovery.authorization_endpoint);
  trustedEndpoint(discovery.token_endpoint);
  return discovery as OidcDiscovery;
}

function createTokenRequest(
  config: AppConfig,
  settings: { clientId: string; redirectUri: string },
  code: string,
  codeVerifier: string
): { body: URLSearchParams; authorization?: string } {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: settings.redirectUri,
    client_id: settings.clientId,
    code_verifier: codeVerifier
  });

  if (config.oidcClientSecret && config.oidcClientAuthMethod === 'client_secret_post') {
    body.set('client_secret', config.oidcClientSecret);
  }

  if (config.oidcClientSecret && config.oidcClientAuthMethod === 'client_secret_basic') {
    const encodedClientId = encodeURIComponent(settings.clientId);
    const encodedClientSecret = encodeURIComponent(config.oidcClientSecret);
    return {
      body,
      authorization: \`Basic \${Buffer.from(\`\${encodedClientId}:\${encodedClientSecret}\`).toString('base64')}\`
    };
  }

  return { body };
}

async function exchangeAuthorizationCode(
  config: AppConfig,
  discovery: OidcDiscovery,
  settings: { clientId: string; redirectUri: string },
  code: string,
  codeVerifier: string
): Promise<string> {
  const tokenRequest = createTokenRequest(config, settings, code, codeVerifier);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded'
  };
  if (tokenRequest.authorization) headers.authorization = tokenRequest.authorization;

  let response: Response;
  try {
    response = await fetch(trustedEndpoint(discovery.token_endpoint), {
      method: 'POST',
      headers,
      body: tokenRequest.body,
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new AppError(502, 'oidc_token_exchange_unavailable', 'Unable to contact the identity provider token endpoint.');
  }
  if (!response.ok) {
    throw new AppError(401, 'oidc_token_exchange_rejected', 'The identity provider rejected the sign-in response. Start again.');
  }

  let tokens: { id_token?: unknown };
  try {
    tokens = await response.json() as { id_token?: unknown };
  } catch {
    throw new AppError(502, 'oidc_token_response_invalid', 'The identity provider returned an invalid token response.');
  }
  if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 20_000) {
    throw new AppError(401, 'oidc_id_token_missing', 'The identity provider did not return a valid ID token.');
  }
  return tokens.id_token;
}

async function verifyIdentityToken(
  config: AppConfig,
  idToken: string,
  expectedNonceHash: string
): Promise<AuthenticatedUser> {
  if (!config.oidcIssuerUrl || !config.oidcClientId || !config.oidcJwksUrl) {
    throw new AppError(503, 'oidc_login_not_configured', 'OIDC browser login is not configured.');
  }

  try {
    const jwks = createRemoteJWKSet(trustedEndpoint(config.oidcJwksUrl));
    const verified = await jwtVerify(idToken, jwks, {
      issuer: config.oidcIssuerUrl,
      audience: config.oidcClientId,
      algorithms: ['RS256', 'ES256']
    });
    const nonce = verified.payload.nonce;
    const subject = verified.payload.sub;
    if (
      typeof nonce !== 'string' ||
      !secureEqual(sha256(nonce), expectedNonceHash) ||
      typeof subject !== 'string' ||
      subject.trim() === ''
    ) {
      throw new AppError(401, 'oidc_identity_invalid', 'The identity token failed sign-in validation.');
    }

    const email = typeof verified.payload.email === 'string'
      ? verified.payload.email.trim().toLowerCase()
      : undefined;
    return {
      userId: subject,
      issuer: config.oidcIssuerUrl,
      email,
      emailVerified: verified.payload.email_verified === true,
      authMethod: 'session'
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'oidc_identity_invalid', 'The identity token is invalid or expired.');
  }
}

async function createSession(
  pool: Pool,
  config: AppConfig,
  user: AuthenticatedUser,
  userAgent: string | undefined
): Promise<{ id: string; token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const sessionHash = sha256(token);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: string; expires_at: Date | string }>(
      "INSERT INTO public.auth_sessions (session_hash, user_id, issuer, email, email_verified, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 * INTERVAL '1 second')) RETURNING id, expires_at",
      [
        sessionHash,
        user.userId,
        user.issuer,
        user.email ?? null,
        user.emailVerified === true,
        userAgent?.slice(0, 512) ?? null,
        config.authSessionTtlSeconds
      ]
    );
    const session = inserted.rows[0];
    await client.query(
      "INSERT INTO public.auth_security_events (user_id, session_id, event_type) VALUES ($1, $2::uuid, 'login.succeeded')",
      [user.userId, session.id]
    );
    await client.query('COMMIT');
    return {
      id: session.id,
      token,
      expiresAt: new Date(session.expires_at).toISOString()
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
  authenticate: preHandlerHookHandler
): Promise<void> {
  app.get('/api/v1/auth/oidc/start', async (_request, reply) => {
    const settings = requireLoginConfig(config);
    const discovery = await loadDiscovery(settings.issuer);
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const stateHash = sha256(state);
    const vault = createTokenVault(settings.encryptionKey);
    const verifierEnvelope = vault.encrypt(codeVerifier, \`oidc-pkce:\${stateHash}\`);
    const codeChallenge = createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');

    await pool.query('DELETE FROM public.auth_login_transactions WHERE expires_at <= NOW()');
    await pool.query(
      'INSERT INTO public.auth_login_transactions (state_hash, nonce_hash, code_verifier_envelope, expires_at) VALUES ($1, $2, $3::jsonb, NOW() + INTERVAL \\'10 minutes\\')',
      [stateHash, sha256(nonce), JSON.stringify(verifierEnvelope)]
    );

    const authorizationUrl = trustedEndpoint(discovery.authorization_endpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', settings.clientId);
    authorizationUrl.searchParams.set('redirect_uri', settings.redirectUri);
    authorizationUrl.searchParams.set('scope', 'openid email profile');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');

    reply
      .header('Cache-Control', 'no-store')
      .header('Pragma', 'no-cache')
      .header('Set-Cookie', serializeCookie(OIDC_STATE_COOKIE_NAME, state, {
        maxAgeSeconds: 600,
        secure: config.sessionCookieSecure
      }));
    return reply.redirect(authorizationUrl.toString());
  });

  app.get('/api/v1/auth/oidc/callback', async (request, reply) => {
    try {
      const parsed = callbackQuerySchema.safeParse(request.query);
      if (!parsed.success || !parsed.data.state) {
        throw new AppError(400, 'oidc_callback_invalid', 'The sign-in callback is missing required parameters.');
      }

      const stateCookie = readCookie(request.headers.cookie, OIDC_STATE_COOKIE_NAME);
      if (!stateCookie || !secureEqual(stateCookie, parsed.data.state)) {
        throw new AppError(401, 'oidc_state_mismatch', 'The sign-in state could not be verified. Start again.');
      }

      const settings = requireLoginConfig(config);
      const stateHash = sha256(parsed.data.state);
      const transaction = await pool.query<LoginTransaction>(
        'DELETE FROM public.auth_login_transactions WHERE state_hash = $1 AND expires_at > NOW() RETURNING nonce_hash, code_verifier_envelope',
        [stateHash]
      );
      const loginTransaction = transaction.rows[0];
      if (!loginTransaction) {
        throw new AppError(401, 'oidc_transaction_expired', 'The sign-in request has expired or has already been used. Start again.');
      }
      if (parsed.data.error) {
        throw new AppError(401, 'oidc_provider_rejected', 'Sign-in was not completed by the identity provider.');
      }
      if (!parsed.data.code) {
        throw new AppError(400, 'oidc_authorization_code_missing', 'The sign-in callback did not include an authorization code.');
      }

      const codeVerifier = createTokenVault(settings.encryptionKey)
        .decrypt(loginTransaction.code_verifier_envelope, \`oidc-pkce:\${stateHash}\`);
      const discovery = await loadDiscovery(settings.issuer);
      const idToken = await exchangeAuthorizationCode(
        config,
        discovery,
        { clientId: settings.clientId, redirectUri: settings.redirectUri },
        parsed.data.code,
        codeVerifier
      );
      const user = await verifyIdentityToken(config, idToken, loginTransaction.nonce_hash);
      const session = await createSession(
        pool,
        config,
        user,
        typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined
      );

      const destination = new URL('/', config.authFrontendUrl);
      destination.searchParams.set('auth', 'success');
      reply
        .header('Cache-Control', 'no-store')
        .header('Pragma', 'no-cache')
        .header('Set-Cookie', [
          clearCookie(OIDC_STATE_COOKIE_NAME, config.sessionCookieSecure),
          serializeCookie(SESSION_COOKIE_NAME, session.token, {
            maxAgeSeconds: config.authSessionTtlSeconds,
            secure: config.sessionCookieSecure
          })
        ]);
      return reply.redirect(destination.toString());
    } catch (error) {
      reply
        .header('Cache-Control', 'no-store')
        .header('Set-Cookie', clearCookie(OIDC_STATE_COOKIE_NAME, config.sessionCookieSecure));
      if (error instanceof AppError) throw error;
      request.log.warn('OIDC callback failed without exposing provider details.');
      throw new AppError(502, 'oidc_callback_failed', 'Unable to complete sign-in. Start again.');
    }
  });

  app.get('/api/v1/auth/session', { preHandler: authenticate }, async (request) => {
    const user = requireUser(request);
    return {
      user: {
        id: user.userId,
        email: user.email ?? null,
        emailVerified: user.emailVerified === true,
        issuer: user.issuer
      },
      authentication: {
        method: user.authMethod ?? 'bearer',
        expiresAt: user.sessionExpiresAt ?? null
      }
    };
  });

  app.get('/api/v1/auth/sessions', { preHandler: authenticate }, async (request) => {
    const user = requireUser(request);
    const sessions = await pool.query<{
      id: string;
      created_at: Date | string;
      last_seen_at: Date | string;
      expires_at: Date | string;
    }>(
      'SELECT id, created_at, last_seen_at, expires_at FROM public.auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY last_seen_at DESC LIMIT 50',
      [user.userId]
    );
    return {
      sessions: sessions.rows.map((session) => ({
        id: session.id,
        createdAt: new Date(session.created_at).toISOString(),
        lastSeenAt: new Date(session.last_seen_at).toISOString(),
        expiresAt: new Date(session.expires_at).toISOString(),
        current: session.id === user.sessionId
      }))
    };
  });

  app.delete('/api/v1/auth/sessions/:sessionId', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const parsed = sessionIdSchema.safeParse(request.params);
    if (!parsed.success) throw new AppError(400, 'invalid_session_id', 'A valid session ID is required.');

    const revoked = await pool.query<{ id: string }>(
      'UPDATE public.auth_sessions SET revoked_at = NOW() WHERE id = $1::uuid AND user_id = $2 AND revoked_at IS NULL RETURNING id',
      [parsed.data.sessionId, user.userId]
    );
    if (!revoked.rowCount) throw new AppError(404, 'session_not_found', 'An active session with this ID was not found.');

    await pool.query(
      "INSERT INTO public.auth_security_events (user_id, session_id, event_type) VALUES ($1, $2::uuid, 'session.revoked')",
      [user.userId, parsed.data.sessionId]
    );
    if (parsed.data.sessionId === user.sessionId) {
      reply.header('Set-Cookie', clearCookie(SESSION_COOKIE_NAME, config.sessionCookieSecure));
    }
    return { revoked: true, sessionId: parsed.data.sessionId };
  });

  app.post('/api/v1/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    if (user.authMethod !== 'session' || !user.sessionId) {
      throw new AppError(400, 'browser_session_required', 'This endpoint revokes browser sessions. Identity-provider access tokens are managed separately.');
    }

    await pool.query(
      'UPDATE public.auth_sessions SET revoked_at = NOW() WHERE id = $1::uuid AND user_id = $2 AND revoked_at IS NULL',
      [user.sessionId, user.userId]
    );
    await pool.query(
      "INSERT INTO public.auth_security_events (user_id, session_id, event_type) VALUES ($1, $2::uuid, 'logout')",
      [user.userId, user.sessionId]
    );
    reply.header('Set-Cookie', clearCookie(SESSION_COOKIE_NAME, config.sessionCookieSecure));
    return { loggedOut: true };
  });

  app.post('/api/v1/auth/sessions/revoke-all', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const revoked = await pool.query<{ id: string }>(
      'UPDATE public.auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() RETURNING id',
      [user.userId]
    );
    await pool.query(
      "INSERT INTO public.auth_security_events (user_id, event_type, metadata) VALUES ($1, 'sessions.revoked', jsonb_build_object('count', $2::integer))",
      [user.userId, revoked.rowCount ?? 0]
    );
    reply.header('Set-Cookie', clearCookie(SESSION_COOKIE_NAME, config.sessionCookieSecure));
    return { revokedCount: revoked.rowCount ?? 0 };
  });
}
