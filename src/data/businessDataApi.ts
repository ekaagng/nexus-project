import { ApiError, apiRequest, workspaceHeaders } from '../auth/api.js';
import type { WorkspaceData } from '../domain.js';
import {
  BUSINESS_DATA_RESOURCES,
  changedBusinessRecordFields,
  deserializeBusinessRecord,
  resourceForBusinessDataKey,
  serializeBusinessRecord,
  type BusinessDataKey,
  type BusinessDataResource
} from './businessDataMapping.js';

type ResourceListResponse = {
  items: Array<Record<string, unknown>>;
  page: { limit: number; offset: number; hasMore: boolean };
};

function resourcePath(resource: BusinessDataResource): string {
  return `/api/v1/business-data/${encodeURIComponent(resource)}`;
}

export async function listBusinessCollection<K extends BusinessDataKey>(
  workspaceId: string,
  key: K,
  signal?: AbortSignal
): Promise<WorkspaceData[K]> {
  const resource = resourceForBusinessDataKey(key);
  const items: WorkspaceData[K][number][] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await apiRequest<ResourceListResponse>(
      `${resourcePath(resource)}?limit=500&offset=${offset}`,
      { headers: workspaceHeaders(workspaceId), signal }
    );
    items.push(...result.items.map(item => deserializeBusinessRecord(key, item)));
    hasMore = result.page.hasMore;
    offset += result.page.limit;
    if (offset > 1_000_000) throw new Error(`Pagination limit exceeded while loading ${resource}.`);
  }

  return items as WorkspaceData[K];
}

export async function loadBusinessCollections(
  workspaceId: string,
  signal?: AbortSignal
): Promise<Pick<WorkspaceData, BusinessDataKey>> {
  const values = await Promise.all(
    BUSINESS_DATA_RESOURCES.map(async ({ key }) => [key, await listBusinessCollection(workspaceId, key, signal)] as const)
  );
  return Object.fromEntries(values) as Pick<WorkspaceData, BusinessDataKey>;
}

async function createRecord(
  workspaceId: string,
  key: BusinessDataKey,
  record: Record<string, unknown>
): Promise<void> {
  const resource = resourceForBusinessDataKey(key);
  await apiRequest(
    resourcePath(resource),
    {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      body: serializeBusinessRecord(key, record)
    }
  );
}

export async function migrateLegacyBusinessCollections(
  workspaceId: string,
  legacy: WorkspaceData,
  onProgress?: (resource: BusinessDataResource, completed: number, total: number) => void
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  // Parent records must exist before records that reference them.
  for (const { key, resource } of BUSINESS_DATA_RESOURCES) {
    const existing = await listBusinessCollection(workspaceId, key);
    const existingIds = new Set((existing as Array<{ id: string }>).map(item => item.id));
    const source = legacy[key] as Array<Record<string, unknown>>;
    const total = source.length;
    let completed = 0;

    for (const record of source) {
      const id = typeof record.id === 'string' ? record.id : '';
      if (!id) throw new Error(`Migrasi ${resource} gagal: ada record tanpa ID.`);
      if (existingIds.has(id)) {
        skipped++;
        completed++;
        onProgress?.(resource, completed, total);
        continue;
      }

      try {
        await createRecord(workspaceId, key, record);
        existingIds.add(id);
        imported++;
      } catch (error) {
        // A concurrent import may have inserted the same ID after the initial list.
        if (error instanceof ApiError && error.status === 409) {
          const refreshed = await listBusinessCollection(workspaceId, key);
          if ((refreshed as Array<{ id: string }>).some(item => item.id === id)) {
            existingIds.add(id);
            skipped++;
            completed++;
            onProgress?.(resource, completed, total);
            continue;
          }
        }
        const message = error instanceof Error ? error.message : 'unknown API error';
        throw new Error(`Migrasi ${resource} · ${id} gagal: ${message}`);
      }
      completed++;
      onProgress?.(resource, completed, total);
    }
  }

  return { imported, skipped };
}

export async function persistBusinessCollectionChanges<K extends BusinessDataKey>(
  workspaceId: string,
  key: K,
  before: WorkspaceData[K],
  after: WorkspaceData[K]
): Promise<void> {
  const resource = resourceForBusinessDataKey(key);
  const previous = before as Array<Record<string, unknown>>;
  const next = after as Array<Record<string, unknown>>;
  const previousById = new Map(previous.map(item => [String(item.id), item]));
  const nextById = new Map(next.map(item => [String(item.id), item]));

  for (const item of previous) {
    const id = String(item.id);
    if (!nextById.has(id)) {
      await apiRequest(
        `${resourcePath(resource)}/${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: workspaceHeaders(workspaceId) }
      );
    }
  }

  for (const item of next) {
    const id = String(item.id);
    const oldItem = previousById.get(id);
    if (!oldItem) {
      await createRecord(workspaceId, key, item);
      continue;
    }

    const patch = changedBusinessRecordFields(key, oldItem, item);
    if (Object.keys(patch).length > 0) {
      await apiRequest(
        `${resourcePath(resource)}/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: workspaceHeaders(workspaceId),
          body: patch
        }
      );
    }
  }
}

export async function replaceBusinessCollections(
  workspaceId: string,
  before: WorkspaceData,
  after: WorkspaceData
): Promise<void> {
  // Delete dependants before their parent; then create/update parents before dependants.
  for (const { key } of [...BUSINESS_DATA_RESOURCES].reverse()) {
    await persistBusinessCollectionChanges(workspaceId, key, before[key], after[key]);
  }
  for (const { key } of BUSINESS_DATA_RESOURCES) {
    await persistBusinessCollectionChanges(workspaceId, key, [], after[key]);
  }
}
