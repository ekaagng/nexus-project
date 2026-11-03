import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { getWorkspaceHeader, withWorkspaceContext } from '../db.js';
import { AppError } from '../errors.js';
import type { AuthenticatedUser } from '../auth/types.js';

function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.authUser) throw new AppError(401, 'authentication_required', 'Authentication is required.');
  return request.authUser;
}

export async function registerIntegrationRoutes(app: FastifyInstance, pool: Pool, authenticate: (request: FastifyRequest) => Promise<void>): Promise<void> {
  app.get('/api/v1/integrations', { preHandler: authenticate }, async (request) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    return withWorkspaceContext(pool, user.userId, workspaceId, async (client) => {
      const result = await client.query(
        `SELECT id, provider, external_account_id, account_name, account_type, status,
                scopes, connected_at, last_attempt_at, last_successful_sync_at,
                last_error_code, last_error_message_safe, created_at, updated_at
         FROM integration_connections
         WHERE workspace_id = $1::uuid
         ORDER BY provider, account_name`,
        [workspaceId]
      );
      return { integrations: result.rows };
    });
  });
}
