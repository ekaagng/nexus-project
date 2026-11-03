export type ProviderId =
  | 'meta_ads'
  | 'scalev'
  | 'lynk_id'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'gmail'
  | 'google_drive';

export type SyncResource =
  | 'orders'
  | 'ad_performance_daily'
  | 'social_account_daily_metrics'
  | 'content_performance_snapshots';

export type ConnectorContext = {
  workspaceId: string;
  connectionId: string;
  externalAccountId: string;
  periodStart: string;
  periodEnd: string;
  cursor?: string;
  idempotencyKey: string;
};

export type ConnectorSyncResult<TRecord = unknown> = {
  records: TRecord[];
  cursor?: string;
  received: number;
  inserted: number;
  updated: number;
  skipped: number;
  completedAt: string;
};

export interface ProviderConnector<TRecord = unknown> {
  readonly provider: ProviderId;
  readonly resources: readonly SyncResource[];
  testConnection(connectionId: string): Promise<{ ok: boolean; safeMessage?: string }>;
  sync(resource: SyncResource, context: ConnectorContext): Promise<ConnectorSyncResult<TRecord>>;
}
