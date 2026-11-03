import { Pool, type PoolClient } from 'pg';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';

export function createPool(config: AppConfig, connectionString = config.databaseUrl): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined
  });
}

export async function withUserContext<T>(
  pool: Pool,
  userId: string,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('nexus.user_id', $1, TRUE)", [userId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withWorkspaceContext<T>(
  pool: Pool,
  userId: string,
  workspaceId: string,
  operation: (client: PoolClient, role: string) => Promise<T>
): Promise<T> {
  return withUserContext(pool, userId, async (client) => {
    await client.query("SELECT set_config('nexus.workspace_id', $1, TRUE)", [workspaceId]);
    const access = await client.query<{ role: string | null }>(
      'SELECT nexus_workspace_role($1, $2::uuid) AS role',
      [userId, workspaceId]
    );
    const role = access.rows[0]?.role;
    if (!role) {
      throw new AppError(403, 'workspace_access_denied', 'You do not have access to this workspace.');
    }
    return operation(client, role);
  });
}

export function getWorkspaceHeader(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(400, 'invalid_workspace_id', 'A valid X-Workspace-Id header is required.');
  }
  return value;
}
