/** Server-side connector contracts. Secrets must never be represented in client state. */
export type ProviderId = 'meta_ads' | 'scalev' | 'lynk_id' | 'instagram' | 'tiktok' | 'youtube' | 'gmail' | 'google_drive';
export type ConnectorState = 'connected' | 'stale' | 'planned' | 'error' | 'unavailable';

export type ConnectorHealth = {
  provider: ProviderId;
  state: ConnectorState;
  accountLabel?: string;
  lastAttemptAt?: string;
  lastSuccessfulSyncAt?: string;
  nextScheduledSyncAt?: string;
  freshness?: 'fresh' | 'stale' | 'incomplete' | 'unavailable';
  errorCode?: string;
  errorMessageSafe?: string;
  quotaRemaining?: number;
};

export type SourceLineage = {
  sourceSystem: ProviderId | 'csv_import' | 'manual';
  sourceRecordId?: string;
  periodStart: string;
  periodEnd: string;
  importedAt?: string;
  syncedAt?: string;
  importJobId?: string;
  timezone: 'Asia/Jakarta';
  currency: 'IDR';
  validationState: 'valid' | 'incomplete' | 'rejected' | 'unverified';
};

export type MetricField<T = number> = {
  value: T | null;
  availability: 'available' | 'not_supported' | 'not_authorized' | 'not_synced' | 'not_applicable';
  definition: string;
  denominator?: string;
  lineage: SourceLineage;
};

export type SyncRequest = {
  workspaceId: string;
  connectedAccountId: string;
  periodStart: string;
  periodEnd: string;
  cursor?: string;
  idempotencyKey: string;
};

export type SyncResult<T> = {
  status: 'completed' | 'completed_with_errors' | 'failed';
  records: T[];
  inserted: number;
  updated: number;
  skipped: number;
  errors: { code: string; messageSafe: string; sourceRecordId?: string }[];
  nextCursor?: string;
  completedAt: string;
};

/** Implementations belong in a trusted server runtime, not in the browser bundle. */
export interface ConnectorAdapter<TRecord = unknown> {
  readonly provider: ProviderId;
  validateScopes(scopes: string[]): Promise<{ valid: boolean; missingScopes: string[] }>;
  testConnection(accountReference: string): Promise<ConnectorHealth>;
  sync(request: SyncRequest): Promise<SyncResult<TRecord>>;
}

export const targetSyncMinutes: Partial<Record<ProviderId, number>> = {
  meta_ads: 15,
  scalev: 15,
  lynk_id: 15
};
