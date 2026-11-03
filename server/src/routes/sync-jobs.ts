import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Pool } from 'pg';
import { connectorRegistry } from '../connectors/registry.js';
import type { SyncResource } from '../connectors/types.js';
import { getWorkspaceHeader, withWorkspaceContext } from '../db.js';
import { AppError } from '../errors.js';
import type { AuthenticatedUser } from '../auth/types.js';

const isCalendarDate = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const createJobSchema = z.object({
  connectionId: z.string().uuid(),
  resource: z.enum(['orders', 'ad_performance_daily', 'social_account_daily_metrics', 'content_performance_snapshots']),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate),
  idempotencyKey: z.string().min(8).max(180)
}).refine((value) => value.periodStart < value.periodEnd, {
  message: 'periodEnd must be after periodStart',
  path: ['periodEnd']
});

function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.authUser) throw new AppError(401, 'authentication_required', 'Authentication is required.');
  return request.authUser;
}

export async function registerSyncJobRoutes(app: FastifyInstance, pool: Pool, authenticate: preHandlerHookHandler): Promise<void> {
  app.get('/api/v1/sync-jobs', { preHandler: authenticate }, async (request) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    return withWorkspaceContext(pool, user.userId, workspaceId, async (client) => {
      const result = await client.query(
        `SELECT id, connection_id, provider, resource, status, period_start, period_end,
                attempts, records_received, records_inserted, records_updated, records_skipped,
                error_code, error_message_safe, requested_by, started_at, completed_at, created_at
         FROM sync_jobs
         WHERE workspace_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT 100`,
        [workspaceId]
      );
      return { jobs: result.rows };
    });
  });

  app.post('/api/v1/sync-jobs', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'invalid_sync_job_payload', 'The sync job payload is invalid.');
    const input = parsed.data;

    const result = await withWorkspaceContext(pool, user.userId, workspaceId, async (client) => {
      const connectionResult = await client.query<{ provider: string; status: string }>(
        `SELECT provider, status FROM integration_connections
         WHERE id = $1::uuid AND workspace_id = $2::uuid`,
        [input.connectionId, workspaceId]
      );
      const connection = connectionResult.rows[0];
      if (!connection) throw new AppError(404, 'integration_not_found', 'The integration connection was not found.');
      if (connection.status !== 'connected') throw new AppError(409, 'integration_not_connected', 'The integration must be connected before syncing.');

      const adapter = connectorRegistry.get(connection.provider as Parameters<typeof connectorRegistry.get>[0]);
      if (!adapter || !adapter.resources.includes(input.resource as SyncResource)) {
        throw new AppError(409, 'connector_not_ready', 'No active server connector is registered for this provider and resource yet.');
      }

      const inserted = await client.query(
        `INSERT INTO sync_jobs (
          workspace_id, connection_id, provider, resource, period_start, period_end,
          idempotency_key, requested_by, status
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::date, $6::date, $7, $8, 'queued')
        ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
        RETURNING id, status, created_at`,
        [workspaceId, input.connectionId, connection.provider, input.resource, input.periodStart, input.periodEnd, input.idempotencyKey, user.userId]
      );

      if (inserted.rows[0]) return { job: inserted.rows[0], replayed: false };

      const existing = await client.query(
        `SELECT id, status, created_at, connection_id, resource, period_start, period_end
         FROM sync_jobs WHERE workspace_id = $1::uuid AND idempotency_key = $2`,
        [workspaceId, input.idempotencyKey]
      );
      const prior = existing.rows[0];
      if (!prior || prior.connection_id !== input.connectionId || prior.resource !== input.resource ||
          String(prior.period_start).slice(0, 10) !== input.periodStart ||
          String(prior.period_end).slice(0, 10) !== input.periodEnd) {
        throw new AppError(409, 'idempotency_key_conflict', 'The idempotency key was already used for a different sync request.');
      }
      return { job: { id: prior.id, status: prior.status, created_at: prior.created_at }, replayed: true };
    });

    return reply.code(result.replayed ? 200 : 202).send(result);
  });
}
