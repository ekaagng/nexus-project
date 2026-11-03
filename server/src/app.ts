import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import { createAuthenticate } from './auth/middleware.js';
import { createTokenVerifier } from './auth/oidc.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { registerIntegrationRoutes } from './routes/integrations.js';
import { registerSyncJobRoutes } from './routes/sync-jobs.js';
import { AppError } from './errors.js';

export async function buildApp(config: AppConfig, pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv !== 'test',
    bodyLimit: 1_048_576,
    trustProxy: false
  });

  app.decorateRequest('authUser', null);
  const authenticate = createAuthenticate(createTokenVerifier(config));
  const authenticateHook = async (request: FastifyRequest) => authenticate(request, undefined as never);

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: false,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Workspace-Id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
  });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: { code: 'route_not_found', message: 'Route not found.' } });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: 'Request validation failed.' } });
    }
    request.log.error({ err: error }, 'Unhandled API error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'An unexpected server error occurred.' } });
  });

  await registerHealthRoutes(app, pool);
  await registerWorkspaceRoutes(app, pool, authenticateHook);
  await registerIntegrationRoutes(app, pool, authenticateHook);
  await registerSyncJobRoutes(app, pool, authenticateHook);

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
