import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { AuthenticatedUser } from './types.js';

export type TokenVerifier = (token: string) => Promise<AuthenticatedUser>;

export function createTokenVerifier(config: AppConfig): TokenVerifier {
  if (!config.oidcIssuerUrl || !config.oidcAudience || !config.oidcJwksUrl) {
    return async () => {
      throw new AppError(503, 'auth_not_configured', 'OIDC authentication is not configured for this environment.');
    };
  }

  const issuer = config.oidcIssuerUrl;
  const audience = config.oidcAudience;
  const jwks = createRemoteJWKSet(new URL(config.oidcJwksUrl));

  return async (token) => {
    try {
      const verified = await jwtVerify(token, jwks, {
        issuer,
        audience,
        algorithms: ['RS256', 'ES256']
      });
      const subject = verified.payload.sub;
      if (!subject) {
        throw new AppError(401, 'invalid_token_subject', 'The access token has no subject claim.');
      }
      return {
        userId: subject,
        email: typeof verified.payload.email === 'string' ? verified.payload.email : undefined,
        emailVerified: verified.payload.email_verified === true,
        issuer
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, 'invalid_or_expired_token', 'The access token is invalid or expired.');
    }
  };
}
