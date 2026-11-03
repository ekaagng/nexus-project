import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { withUserContext } from '../db.js';
import { AppError } from '../errors.js';
import type { AuthenticatedUser } from '../auth/types.js';

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(120)
});

function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.authUser) throw new AppError(401, 'authentication_required', 'Authentication is required.');
  return request.authUser;
}

export async function registerWorkspaceRoutes(app: FastifyInstance, pool: Pool, authenticate: (request: FastifyRequest) => Promise<void>): Promise<void> {
  app.get('/api/v1/workspaces', { preHandler: authenticate }, async (request) => {
    const user = requireUser(request);
    return withUserContext(pool, user.userId, async (client) => {
      const result = await client.query(
        `SELECT w.id, w.name, w.timezone, w.currency, wm.role, wm.status, w.created_at
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = $1 AND wm.status = 'active'
         ORDER BY w.created_at ASC`,
        [user.userId]
      );
      return { workspaces: result.rows };
    });
  });

  app.post('/api/v1/workspaces', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const parsed = createWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'invalid_workspace_payload', 'Workspace name must contain 2–120 characters.');
    const workspaceId = randomUUID();
    const created = await withUserContext(pool, user.userId, async (client) => {
      const workspace = await client.query(
        `INSERT INTO workspaces (id, name, created_by) VALUES ($1::uuid, $2, $3)
         RETURNING id, name, timezone, currency, created_at`,
        [workspaceId, parsed.data.name, user.userId]
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1::uuid, $2, 'owner', 'active')`,
        [workspaceId, user.userId]
      );
      return workspace.rows[0];
    });
    return reply.code(201).send({ workspace: { ...created, role: 'owner' } });
  });
}
