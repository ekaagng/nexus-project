import { createHash } from 'node:crypto';
import type { preHandlerHookHandler } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { TokenVerifier } from './oidc.js';
import { readCookie, SESSION_COOKIE_NAME } from './cookies.js';

export function createAuthenticate(
  verifyToken: TokenVerifier,
  pool: Pool,
  config: AppConfig
): preHandlerHookHandler {
  return async (request) => {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      const match = typeof authorization === 'string'
        ? authorization.match(/^Bearer\\s+([^\\s]+)$/i)
        : null;
      if (!match?.[1]) {
        throw new AppError(401, 'authentication_required', 'A valid Bearer access token is required.');
      }
      request.authUser = { ...(await verifyToken(match[1])), authMethod: 'bearer' };
      return;
    }

    const sessionToken = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
      throw new AppError(401, 'authentication_required', 'A valid authenticated session is required.');
    }

    const sessionHash = createHash('sha256').update(sessionToken, 'utf8').digest('hex');
    const result = await pool.query<{
      id: string;
      user_id: string;
      issuer: string;
      email: string | null;
      email_verified: boolean;
      expires_at: Date | string;
    }>(
      `SELECT id, user_id, issuer, email, email_verified, expires_at
         FROM public.auth_sessions
        WHERE session_hash = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
        LIMIT 1`,
      [sessionHash]
    );

    const session = result.rows[0];
    if (!session) {
      throw new AppError(401, 'session_invalid_or_expired', 'Your session is invalid or has expired. Sign in again.');
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !config.corsOrigins.includes(origin)) {
        throw new AppError(403, 'csrf_origin_rejected', 'The request origin is not allowed for session-authenticated actions.');
      }
    }

    await pool.query(
      `UPDATE public.auth_sessions
          SET last_seen_at = NOW()
        WHERE id = $1::uuid
          AND last_seen_at < NOW() - INTERVAL '5 minutes'`,
      [session.id]
    );

    request.authUser = {
      userId: session.user_id,
      issuer: session.issuer,
      email: session.email ?? undefined,
      emailVerified: session.email_verified,
      authMethod: 'session',
      sessionId: session.id,
      sessionExpiresAt: new Date(session.expires_at).toISOString()
    };
  };
}
