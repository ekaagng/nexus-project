import type { preHandlerHookHandler } from 'fastify';
import { AppError } from '../errors.js';
import type { TokenVerifier } from './oidc.js';

export function createAuthenticate(verifyToken: TokenVerifier): preHandlerHookHandler {
  return async (request) => {
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' ? authorization.match(/^Bearer\s+(.+)$/i) : null;
    if (!match?.[1]) {
      throw new AppError(401, 'authentication_required', 'A valid Bearer access token is required.');
    }
    request.authUser = await verifyToken(match[1]);
  };
}
