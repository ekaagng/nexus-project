import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyRequest, type preHandlerHookHandler } from 'fastify';
import type { Pool } from 'pg';
import { registerBusinessDataRoutes } from '../src/routes/business-data.js';
import { AppError } from '../src/errors.js';

const workspaceId = '10000000-0000-4000-8000-000000000001';

const campaignRow = {
  workspace_id: workspaceId,
  id: 'CAM-2026-0001',
  name: 'Always-on launch',
  objective: 'Sales',
  owner: 'Marketing Lead',
  start_date: '2026-11-01',
  end_date: '2026-11-30',
  target_revenue: '49500000.00',
  planned_budget: '12000000.00',
  status: 'Active',
  channels: ['Meta Ads', 'Instagram'],
  description: null,
  created_by: 'user-1',
  version: 1,
  created_at: '2026-11-03T00:00:00.000Z',
  updated_at: '2026-11-03T00:00:00.000Z'
};

const validCampaign = {
  id: 'CAM-2026-0001',
  name: 'Always-on launch',
  objective: 'Sales',
  owner: 'Marketing Lead',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  targetRevenue: '49500000.00',
  plannedBudget: 12000000,
  status: 'Active',
  channels: ['Meta Ads', 'Instagram']
};

function createHarness(options: {
  role?: string;
  listRows?: Record<string, unknown>[];
  insertError?: string;
} = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const role = options.role ?? 'owner';
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.includes("set_config('nexus.user_id'")) return { rows: [], rowCount: 1 };
      if (sql.includes("set_config('nexus.workspace_id'")) return { rows: [], rowCount: 1 };
      if (sql.includes('SELECT nexus_private.workspace_role')) return { rows: [{ role }], rowCount: 1 };
      if (sql.includes('SELECT * FROM public.campaigns') && sql.includes('ORDER BY updated_at')) {
        return { rows: options.listRows ?? [campaignRow], rowCount: (options.listRows ?? [campaignRow]).length };
      }
      if (sql.includes('SELECT * FROM public.campaigns') && sql.includes('LIMIT 1')) {
        return { rows: [campaignRow], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO public.campaigns')) {
        if (options.insertError) {
          const error = new Error('simulated database constraint') as Error & { code: string };
          error.code = options.insertError;
          throw error;
        }
        return { rows: [campaignRow], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE public.campaigns')) {
        return { rows: [{ ...campaignRow, status: 'Paused', version: 2 }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM public.campaigns')) {
        return { rows: [{ id: 'CAM-2026-0001' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO public.audit_logs')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL in business-data test: ${sql}`);
    },
    release: () => undefined
  };
  const pool = {
    connect: async () => client,
    end: async () => undefined
  } as unknown as Pool;

  const app = Fastify({ logger: false });
  app.decorateRequest('authUser', null);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return reply.code(500).send({ error: { code: 'test_unexpected_error', message: error.message } });
  });
  const authenticate: preHandlerHookHandler = async (request: FastifyRequest) => {
    request.authUser = { userId: 'user-1', issuer: 'https://identity.example.com', authMethod: 'bearer' };
  };

  const ready = registerBusinessDataRoutes(app, pool, authenticate).then(() => app.ready());
  return { app, calls, ready };
}

test('campaign create validates input, persists in the selected workspace and records an audit event', async () => {
  const harness = createHarness();
  await harness.ready;
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/business-data/campaigns',
    headers: { 'x-workspace-id': workspaceId },
    payload: validCampaign
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().item.id, 'CAM-2026-0001');
  assert.equal(response.json().item.targetRevenue, '49500000.00');
  assert.equal(harness.calls.some((call) => call.sql.startsWith('INSERT INTO public.campaigns')), true);
  assert.equal(harness.calls.some((call) => call.sql.startsWith('INSERT INTO public.audit_logs')), true);
  await harness.app.close();
});

test('campaign listing is workspace-scoped and exposes bounded pagination', async () => {
  const harness = createHarness({ listRows: [campaignRow, { ...campaignRow, id: 'CAM-2026-0002' }] });
  await harness.ready;
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/business-data/campaigns?limit=1&offset=0',
    headers: { 'x-workspace-id': workspaceId }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items.length, 1);
  assert.equal(response.json().page.hasMore, true);
  const listCall = harness.calls.find((call) => call.sql.includes('ORDER BY updated_at'));
  assert.match(listCall?.sql ?? '', /workspace_id = \$1::uuid/);
  assert.deepEqual(listCall?.values, [workspaceId, 2, 0]);
  await harness.app.close();
});

test('viewer role can read but cannot create operational records', async () => {
  const harness = createHarness({ role: 'viewer' });
  await harness.ready;
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/business-data/campaigns',
    headers: { 'x-workspace-id': workspaceId },
    payload: validCampaign
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'workspace_read_only');
  assert.equal(harness.calls.some((call) => call.sql.startsWith('INSERT INTO public.campaigns')), false);
  await harness.app.close();
});

test('database foreign-key failures become safe client errors', async () => {
  const harness = createHarness({ insertError: '23503' });
  await harness.ready;
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/business-data/campaigns',
    headers: { 'x-workspace-id': workspaceId },
    payload: validCampaign
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, 'business_data_reference_not_found');
  await harness.app.close();
});

test('patch cannot change the record ID or update unrecognized properties', async () => {
  const harness = createHarness();
  await harness.ready;
  const response = await harness.app.inject({
    method: 'PATCH',
    url: '/api/v1/business-data/campaigns/CAM-2026-0001',
    headers: { 'x-workspace-id': workspaceId },
    payload: { id: 'CAM-2026-0002', status: 'Paused' }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'invalid_business_data_payload');
  assert.equal(harness.calls.some((call) => call.sql.startsWith('UPDATE public.campaigns')), false);
  await harness.app.close();
});

test('patch validates the merged record and increments its version', async () => {
  const harness = createHarness();
  await harness.ready;
  const response = await harness.app.inject({
    method: 'PATCH',
    url: '/api/v1/business-data/campaigns/CAM-2026-0001',
    headers: { 'x-workspace-id': workspaceId },
    payload: { status: 'Paused' }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().item.status, 'Paused');
  assert.equal(response.json().item.version, 2);
  assert.equal(harness.calls.some((call) => call.sql.includes('version = version + 1')), true);
  await harness.app.close();
});

test('invalid date ranges are rejected before database writes', async () => {
  const harness = createHarness();
  await harness.ready;
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/business-data/campaigns',
    headers: { 'x-workspace-id': workspaceId },
    payload: { ...validCampaign, endDate: '2026-10-01' }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'invalid_business_data_payload');
  assert.equal(harness.calls.some((call) => call.sql.startsWith('INSERT INTO public.campaigns')), false);
  await harness.app.close();
});

test('resource paths are allowlisted and unknown tables cannot be selected', async () => {
  const harness = createHarness();
  await harness.ready;
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/business-data/campaigns;DROP%20TABLE%20workspaces',
    headers: { 'x-workspace-id': workspaceId }
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'business_data_resource_not_found');
  assert.equal(harness.calls.some((call) => call.sql.includes('DROP TABLE')), false);
  await harness.app.close();
});
