import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { getWorkspaceHeader, withWorkspaceContext } from '../db.js';
import { AppError } from '../errors.js';
import type { AuthenticatedUser } from '../auth/types.js';

const idSchema = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

const isCalendarDate = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate, 'A valid calendar date is required.');
const optionalDateKey = dateKey.nullish();

const money = z.union([
  z.number().refine((value) => Number.isSafeInteger(value) && value >= 0, 'Money numbers must be non-negative safe integers.').transform(String),
  z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, 'Money must be a non-negative decimal string with at most 16 integer and 2 fractional digits.')
]);
const counter = z.union([
  z.number().refine((value) => Number.isSafeInteger(value) && value >= 0, 'Counters must be non-negative safe integers.').transform(String),
  z.string().regex(/^(?:0|[1-9]\d{0,18})$/, 'Counter must be a non-negative integer string.')
]).refine((value) => BigInt(value) <= 9223372036854775807n, 'Counter exceeds PostgreSQL BIGINT.');
const optionalCounter = counter.nullish();
const engagement = z.union([
  z.number().finite().min(0).max(99999.999).transform(String),
  z.string().regex(/^(?:0|[1-9]\d{0,4})(?:\.\d{1,3})?$/)
]).nullish();

const httpUrl = z.string().trim().url().max(2048).refine((value) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}, 'Only HTTP and HTTPS URLs are supported.');

const campaignSchema = z.object({
  id: idSchema,
  name: text(120),
  objective: text(80),
  owner: text(120),
  startDate: dateKey,
  endDate: dateKey,
  targetRevenue: money,
  plannedBudget: money,
  status: text(40),
  channels: z.array(text(40)).max(20),
  description: optionalText(2000)
}).strict().refine((value) => value.startDate < value.endDate, {
  message: 'endDate must be after startDate.',
  path: ['endDate']
});

const briefSchema = z.object({
  id: idSchema,
  title: text(200),
  type: text(40),
  campaignId: idSchema.nullish(),
  status: text(40),
  owner: text(120),
  updatedAt: dateKey
}).strict();

const taskSchema = z.object({
  id: idSchema,
  title: text(200),
  description: optionalText(2000),
  assignee: text(120),
  priority: text(30),
  status: text(40),
  dueDate: dateKey,
  owner: optionalText(120),
  campaignId: idSchema.nullish(),
  kind: optionalText(60)
}).strict();

const contentSchema = z.object({
  id: idSchema,
  title: text(200),
  platform: text(40),
  pillar: text(100),
  format: text(80),
  hook: text(500),
  cta: text(300),
  owner: text(120),
  status: text(40),
  publishDate: dateKey,
  campaignId: idSchema.nullish(),
  views: optionalCounter,
  engagement
}).strict();

const expenseSchema = z.object({
  id: idSchema,
  title: text(200),
  category: text(80),
  vendor: text(160),
  amount: money,
  date: dateKey,
  campaignId: idSchema.nullish(),
  channel: text(80),
  type: z.enum(['actual', 'committed'])
}).strict();

const kolSchema = z.object({
  id: idSchema,
  name: text(160),
  platform: text(40),
  handle: text(120),
  instagramUrl: z.union([httpUrl, z.literal('')]).nullish(),
  niche: text(120),
  contact: z.string().trim().max(200).nullish(),
  rate: money,
  stage: text(40),
  campaignId: idSchema.nullish(),
  publishDate: optionalDateKey,
  notes: optionalText(2000)
}).strict();

const experimentSchema = z.object({
  id: idSchema,
  name: text(200),
  hypothesis: text(2000),
  changeMade: text(2000),
  primaryMetric: text(160),
  successCriteria: text(1000),
  owner: text(120),
  status: text(40),
  startDate: dateKey,
  endDate: optionalDateKey,
  outcome: optionalText(2000),
  campaignId: idSchema.nullish()
}).strict().refine((value) => !value.endDate || value.startDate <= value.endDate, {
  message: 'endDate cannot be before startDate.',
  path: ['endDate']
});

const competitorSchema = z.object({
  id: idSchema,
  name: text(160),
  platform: text(40),
  handle: text(120),
  url: httpUrl,
  label: text(120),
  notes: z.string().trim().max(2000),
  status: text(40)
}).strict();

const competitorPostSchema = z.object({
  id: idSchema,
  competitorId: idSchema,
  title: text(200),
  url: httpUrl,
  observedAt: dateKey,
  views: optionalCounter,
  likes: optionalCounter,
  comments: optionalCounter,
  shares: optionalCounter,
  format: text(80),
  hook: text(500),
  angle: text(300),
  note: z.string().trim().max(2000)
}).strict();

type BusinessResource = {
  table: string;
  schema: z.ZodObject<any>;
  columns: Record<string, string>;
};

const resources = {
  campaigns: {
    table: 'campaigns',
    schema: campaignSchema,
    columns: {
      id: 'id', name: 'name', objective: 'objective', owner: 'owner',
      startDate: 'start_date', endDate: 'end_date', targetRevenue: 'target_revenue',
      plannedBudget: 'planned_budget', status: 'status', channels: 'channels',
      description: 'description'
    }
  },
  briefs: {
    table: 'briefs',
    schema: briefSchema,
    columns: {
      id: 'id', title: 'title', type: 'type', campaignId: 'campaign_id',
      status: 'status', owner: 'owner', updatedAt: 'updated_on'
    }
  },
  tasks: {
    table: 'tasks',
    schema: taskSchema,
    columns: {
      id: 'id', title: 'title', description: 'description', assignee: 'assignee',
      priority: 'priority', status: 'status', dueDate: 'due_date', owner: 'owner',
      campaignId: 'campaign_id', kind: 'kind'
    }
  },
  contents: {
    table: 'content_items',
    schema: contentSchema,
    columns: {
      id: 'id', title: 'title', platform: 'platform', pillar: 'pillar',
      format: 'format', hook: 'hook', cta: 'cta', owner: 'owner', status: 'status',
      publishDate: 'publish_date', campaignId: 'campaign_id', views: 'views',
      engagement: 'engagement'
    }
  },
  expenses: {
    table: 'budget_expenses',
    schema: expenseSchema,
    columns: {
      id: 'id', title: 'title', category: 'category', vendor: 'vendor',
      amount: 'amount', date: 'expense_date', campaignId: 'campaign_id',
      channel: 'channel', type: 'type'
    }
  },
  kols: {
    table: 'kols',
    schema: kolSchema,
    columns: {
      id: 'id', name: 'name', platform: 'platform', handle: 'handle',
      instagramUrl: 'instagram_url', niche: 'niche', contact: 'contact',
      rate: 'rate', stage: 'stage', campaignId: 'campaign_id',
      publishDate: 'publish_date', notes: 'notes'
    }
  },
  experiments: {
    table: 'experiments',
    schema: experimentSchema,
    columns: {
      id: 'id', name: 'name', hypothesis: 'hypothesis', changeMade: 'change_made',
      primaryMetric: 'primary_metric', successCriteria: 'success_criteria',
      owner: 'owner', status: 'status', startDate: 'start_date',
      endDate: 'end_date', outcome: 'outcome', campaignId: 'campaign_id'
    }
  },
  competitors: {
    table: 'competitors',
    schema: competitorSchema,
    columns: {
      id: 'id', name: 'name', platform: 'platform', handle: 'handle',
      url: 'url', label: 'label', notes: 'notes', status: 'status'
    }
  },
  'competitor-posts': {
    table: 'competitor_posts',
    schema: competitorPostSchema,
    columns: {
      id: 'id', competitorId: 'competitor_id', title: 'title', url: 'url',
      observedAt: 'observed_at', views: 'views', likes: 'likes',
      comments: 'comments', shares: 'shares', format: 'format',
      hook: 'hook', angle: 'angle', note: 'note'
    }
  }
} satisfies Record<string, BusinessResource>;

type ResourceName = keyof typeof resources;

function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.authUser) throw new AppError(401, 'authentication_required', 'Authentication is required.');
  return request.authUser;
}

function getResource(value: string): [ResourceName, BusinessResource] {
  if (!Object.prototype.hasOwnProperty.call(resources, value)) {
    throw new AppError(404, 'business_data_resource_not_found', 'The requested business data resource was not found.');
  }
  const key = value as ResourceName;
  return [key, resources[key]];
}

function requireWriteRole(role: string): void {
  if (role === 'viewer') {
    throw new AppError(403, 'workspace_read_only', 'Your workspace role only allows read access.');
  }
}

function toApiRecord(resource: BusinessResource, row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(resource.columns)) {
    const value = row[column];
    if (value !== null && value !== undefined) result[key] = value;
  }
  result.version = row.version;
  result.createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  result.systemUpdatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at;
  return result;
}

async function writeAudit(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  action: string,
  resource: string,
  recordId: string,
  version?: number
): Promise<void> {
  await client.query(
    `INSERT INTO public.audit_logs (
       workspace_id, actor_user_id, action, entity_type, entity_id, metadata
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)`,
    [workspaceId, userId, action, resource, recordId, JSON.stringify(version ? { version } : {})]
  );
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  if (code === '23505') throw new AppError(409, 'business_data_conflict', 'A record with this ID already exists in the workspace.');
  if (code === '23503') throw new AppError(422, 'business_data_reference_not_found', 'A referenced campaign or competitor does not exist in this workspace.');
  if (code === '23514' || code === '22P02' || code === '22003') {
    throw new AppError(400, 'business_data_constraint_violation', 'The record contains a value that violates a data constraint.');
  }
  throw error;
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
}).strict();

export async function registerBusinessDataRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler
): Promise<void> {
  app.get('/api/v1/business-data/:resource', { preHandler: authenticate }, async (request) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const params = request.params as { resource: string };
    const [, resource] = getResource(params.resource);
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) throw new AppError(400, 'invalid_pagination', 'Pagination values must use limit 1–500 and a non-negative offset.');

    try {
      return await withWorkspaceContext(pool, user.userId, workspaceId, async (client) => {
        const { limit, offset } = query.data;
        const result = await client.query(
          `SELECT * FROM public.${resource.table}
           WHERE workspace_id = $1::uuid
           ORDER BY updated_at DESC, id ASC
           LIMIT $2 OFFSET $3`,
          [workspaceId, limit + 1, offset]
        );
        const hasMore = result.rows.length > limit;
        return {
          items: result.rows.slice(0, limit).map((row) => toApiRecord(resource, row as Record<string, unknown>)),
          page: { limit, offset, hasMore }
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  });

  app.post('/api/v1/business-data/:resource', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const params = request.params as { resource: string };
    const [resourceName, resource] = getResource(params.resource);
    const parsed = resource.schema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'invalid_business_data_payload', 'The business data record failed validation.');
    const data = parsed.data as Record<string, unknown>;

    try {
      const item = await withWorkspaceContext(pool, user.userId, workspaceId, async (client, role) => {
        requireWriteRole(role);
        const keys = Object.keys(resource.columns).filter((key) => Object.hasOwn(data, key) && data[key] !== undefined);
        const columns = ['workspace_id', 'created_by', ...keys.map((key) => resource.columns[key])];
        const values: unknown[] = [workspaceId, user.userId, ...keys.map((key) => data[key])];
        const placeholders = values.map((_, index) => index === 0 ? '$1::uuid' : `$${index + 1}`);
        const inserted = await client.query(
          `INSERT INTO public.${resource.table} (${columns.join(', ')})
           VALUES (${placeholders.join(', ')})
           RETURNING *`,
          values
        );
        const row = inserted.rows[0] as Record<string, unknown>;
        await writeAudit(client, workspaceId, user.userId, 'business_data.created', resourceName, String(data.id), Number(row.version));
        return toApiRecord(resource, row);
      });
      return reply.code(201).send({ item });
    } catch (error) {
      translateDatabaseError(error);
    }
  });

  app.patch('/api/v1/business-data/:resource/:id', { preHandler: authenticate }, async (request) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const params = request.params as { resource: string; id: string };
    const [resourceName, resource] = getResource(params.resource);
    const id = idSchema.safeParse(params.id);
    if (!id.success) throw new AppError(400, 'invalid_business_data_id', 'The record ID is invalid.');
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      throw new AppError(400, 'invalid_business_data_payload', 'The patch body must be a JSON object.');
    }
    const patch = request.body as Record<string, unknown>;
    const patchKeys = Object.keys(patch);
    if (patchKeys.length === 0 || patchKeys.includes('id') || patchKeys.some((key) => !Object.hasOwn(resource.columns, key) || key === 'id')) {
      throw new AppError(400, 'invalid_business_data_payload', 'The patch must contain valid editable fields and cannot change the record ID.');
    }

    try {
      return await withWorkspaceContext(pool, user.userId, workspaceId, async (client, role) => {
        requireWriteRole(role);
        const existingResult = await client.query(
          `SELECT * FROM public.${resource.table}
           WHERE workspace_id = $1::uuid AND id = $2
           LIMIT 1`,
          [workspaceId, id.data]
        );
        const existing = existingResult.rows[0] as Record<string, unknown> | undefined;
        if (!existing) throw new AppError(404, 'business_data_record_not_found', 'The requested record was not found.');

        const currentData: Record<string, unknown> = {};
        for (const [key, column] of Object.entries(resource.columns)) currentData[key] = existing[column] ?? null;
        const parsed = resource.schema.safeParse({ ...currentData, ...patch, id: id.data });
        if (!parsed.success) throw new AppError(400, 'invalid_business_data_payload', 'The updated record failed validation.');
        const updatedData = parsed.data as Record<string, unknown>;

        const values: unknown[] = [workspaceId, id.data];
        const assignments = patchKeys.map((key) => {
          values.push(updatedData[key]);
          return `${resource.columns[key]} = $${values.length}`;
        });
        assignments.push('updated_at = NOW()', 'version = version + 1');
        const updated = await client.query(
          `UPDATE public.${resource.table}
           SET ${assignments.join(', ')}
           WHERE workspace_id = $1::uuid AND id = $2
           RETURNING *`,
          values
        );
        const row = updated.rows[0] as Record<string, unknown>;
        await writeAudit(client, workspaceId, user.userId, 'business_data.updated', resourceName, id.data, Number(row.version));
        return { item: toApiRecord(resource, row) };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  });

  app.delete('/api/v1/business-data/:resource/:id', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const params = request.params as { resource: string; id: string };
    const [resourceName, resource] = getResource(params.resource);
    const id = idSchema.safeParse(params.id);
    if (!id.success) throw new AppError(400, 'invalid_business_data_id', 'The record ID is invalid.');

    try {
      await withWorkspaceContext(pool, user.userId, workspaceId, async (client, role) => {
        requireWriteRole(role);
        const deleted = await client.query(
          `DELETE FROM public.${resource.table}
           WHERE workspace_id = $1::uuid AND id = $2
           RETURNING id`,
          [workspaceId, id.data]
        );
        if (!deleted.rows[0]) throw new AppError(404, 'business_data_record_not_found', 'The requested record was not found.');
        await writeAudit(client, workspaceId, user.userId, 'business_data.deleted', resourceName, id.data);
      });
      return reply.code(204).send();
    } catch (error) {
      translateDatabaseError(error);
    }
  });
}
