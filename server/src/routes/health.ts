import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export async function registerHealthRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok', service: 'nexus-api' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ready', database: 'reachable' };
    } catch {
      return reply.code(503).send({ status: 'not_ready', database: 'unreachable' });
    }
  });
}
