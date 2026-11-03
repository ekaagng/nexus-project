import type {
  AdMetric, Brief, Campaign, Competitor, CompetitorPost, ContentItem, Expense,
  Experiment, Kol, Order, Task, WorkspaceData
} from '../domain.js';

export type BusinessDataKey =
  | 'campaigns'
  | 'briefs'
  | 'tasks'
  | 'contents'
  | 'expenses'
  | 'kols'
  | 'experiments'
  | 'competitors'
  | 'competitorPosts';

export type BusinessDataResource =
  | 'campaigns'
  | 'briefs'
  | 'tasks'
  | 'contents'
  | 'expenses'
  | 'kols'
  | 'experiments'
  | 'competitors'
  | 'competitor-posts';

export const BUSINESS_DATA_RESOURCES: ReadonlyArray<{
  key: BusinessDataKey;
  resource: BusinessDataResource;
}> = [
  { key: 'campaigns', resource: 'campaigns' },
  { key: 'briefs', resource: 'briefs' },
  { key: 'tasks', resource: 'tasks' },
  { key: 'contents', resource: 'contents' },
  { key: 'expenses', resource: 'expenses' },
  { key: 'kols', resource: 'kols' },
  { key: 'experiments', resource: 'experiments' },
  { key: 'competitors', resource: 'competitors' },
  { key: 'competitorPosts', resource: 'competitor-posts' }
];

const resourceByKey = new Map(BUSINESS_DATA_RESOURCES.map(item => [item.key, item.resource]));

export function resourceForBusinessDataKey(key: BusinessDataKey): BusinessDataResource {
  const resource = resourceByKey.get(key);
  if (!resource) throw new Error(`Unsupported business data collection: ${key}`);
  return resource;
}

type BusinessRecord =
  | Campaign | Brief | Task | ContentItem | Expense | Kol
  | Experiment | Competitor | CompetitorPost;

function moneyToDecimal(value: unknown, field: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite non-negative number.`);
  }
  if (!Number.isSafeInteger(value) && !Number.isInteger(value)) {
    const decimal = value.toFixed(2);
    if (Number(decimal) !== value) {
      throw new TypeError(`${field} supports at most two decimal places.`);
    }
    return decimal;
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${field} exceeds JavaScript's safe integer range.`);
  }
  return String(value);
}

function safeCounter(value: unknown, field: string): number {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new RangeError(`${field} exceeds JavaScript's safe integer range.`);
    return parsed;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${field} must be a non-negative safe integer.`);
}

function safeAmount(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} is not a valid numeric value.`);
  return parsed;
}

export function serializeBusinessRecord(
  key: BusinessDataKey,
  value: BusinessRecord | Record<string, unknown>
): Record<string, unknown> {
  const record = { ...(value as Record<string, unknown>) };
  const moneyFields: Partial<Record<BusinessDataKey, string[]>> = {
    campaigns: ['targetRevenue', 'plannedBudget'],
    expenses: ['amount'],
    kols: ['rate']
  };
  for (const field of moneyFields[key] ?? []) {
    if (record[field] !== undefined && record[field] !== null) {
      record[field] = moneyToDecimal(record[field], field);
    }
  }
  return record;
}

export function deserializeBusinessRecord<K extends BusinessDataKey>(
  key: K,
  value: Record<string, unknown>
): WorkspaceData[K][number] {
  const record = { ...value };
  const moneyFields: Partial<Record<BusinessDataKey, string[]>> = {
    campaigns: ['targetRevenue', 'plannedBudget'],
    expenses: ['amount'],
    kols: ['rate']
  };
  for (const field of moneyFields[key] ?? []) {
    if (record[field] !== undefined && record[field] !== null) {
      record[field] = safeAmount(record[field], field);
    }
  }

  const counterFields: Partial<Record<BusinessDataKey, string[]>> = {
    contents: ['views'],
    competitorPosts: ['views', 'likes', 'comments', 'shares']
  };
  for (const field of counterFields[key] ?? []) {
    if (record[field] !== undefined && record[field] !== null) {
      record[field] = safeCounter(record[field], field);
    }
  }
  if (key === 'contents' && record.engagement !== undefined && record.engagement !== null) {
    record.engagement = safeAmount(record.engagement, 'engagement');
  }
  return record as WorkspaceData[K][number];
}

export function createEmptyWorkspaceData(): WorkspaceData {
  return {
    campaigns: [],
    tasks: [],
    contents: [],
    expenses: [],
    kols: [],
    orders: [],
    ads: [],
    briefs: [],
    experiments: [],
    competitors: [],
    competitorPosts: [],
    notifications: [],
    updatedAt: new Date().toISOString()
  };
}

export function localOnlyWorkspaceData(data: WorkspaceData): Pick<WorkspaceData, 'orders' | 'ads' | 'notifications' | 'updatedAt'> {
  return {
    orders: data.orders,
    ads: data.ads,
    notifications: data.notifications,
    updatedAt: data.updatedAt
  };
}

export function parseLegacyWorkspace(raw: string): WorkspaceData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Data local lama bukan JSON yang valid. File backup asli tetap dipertahankan.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Struktur data local lama tidak dikenali. File backup asli tetap dipertahankan.');
  }
  const value = parsed as Record<string, unknown>;
  const arrayKeys: Array<keyof WorkspaceData> = [
    'campaigns', 'tasks', 'contents', 'expenses', 'kols', 'orders', 'ads',
    'briefs', 'experiments', 'competitors', 'competitorPosts', 'notifications'
  ];
  for (const key of arrayKeys) {
    if (value[key] !== undefined && !Array.isArray(value[key])) {
      throw new Error(`Data local lama pada bagian ${key} tidak valid. File backup asli tetap dipertahankan.`);
    }
  }
  return {
    ...createEmptyWorkspaceData(),
    ...value,
    campaigns: (value.campaigns as Campaign[] | undefined) ?? [],
    tasks: (value.tasks as Task[] | undefined) ?? [],
    contents: (value.contents as ContentItem[] | undefined) ?? [],
    expenses: (value.expenses as Expense[] | undefined) ?? [],
    kols: (value.kols as Kol[] | undefined) ?? [],
    orders: (value.orders as Order[] | undefined) ?? [],
    ads: (value.ads as AdMetric[] | undefined) ?? [],
    briefs: (value.briefs as Brief[] | undefined) ?? [],
    experiments: (value.experiments as Experiment[] | undefined) ?? [],
    competitors: (value.competitors as Competitor[] | undefined) ?? [],
    competitorPosts: (value.competitorPosts as CompetitorPost[] | undefined) ?? [],
    notifications: (value.notifications as WorkspaceData['notifications'] | undefined) ?? [],
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  };
}

export function changedBusinessRecordFields(
  key: BusinessDataKey,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  fields.delete('id');
  for (const field of fields) {
    const previous = before[field];
    const next = after[field];
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    patch[field] = next === undefined ? null : next;
  }
  return serializeBusinessRecord(key, patch);
}
