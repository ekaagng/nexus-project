CREATE TABLE IF NOT EXISTS nexus_schema_migrations (
  migration_name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_status_idx ON workspace_members(user_id, status);

CREATE SCHEMA IF NOT EXISTS nexus_private;

CREATE OR REPLACE FUNCTION nexus_private.is_workspace_member(p_user_id TEXT, p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_user_id
      AND wm.status = 'active'
  ), FALSE);
$$;

CREATE OR REPLACE FUNCTION nexus_private.workspace_role(p_user_id TEXT, p_workspace_id UUID)
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT wm.role FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = p_user_id
    AND wm.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION nexus_private.workspace_created_by(p_user_id TEXT, p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = p_workspace_id AND w.created_by = p_user_id
  ), FALSE);
$$;

CREATE TABLE integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('meta_ads', 'scalev', 'lynk_id', 'instagram', 'tiktok', 'youtube', 'gmail', 'google_drive')),
  external_account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'reauth_required', 'error', 'disabled')),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_by TEXT NOT NULL,
  connected_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message_safe TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, external_account_id),
  UNIQUE (workspace_id, id)
);
CREATE INDEX integration_connections_workspace_idx ON integration_connections(workspace_id, provider, status);

CREATE TABLE integration_secrets (
  connection_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  access_token_ciphertext BYTEA NOT NULL,
  access_token_iv BYTEA NOT NULL,
  access_token_auth_tag BYTEA NOT NULL,
  refresh_token_ciphertext BYTEA,
  refresh_token_iv BYTEA,
  refresh_token_auth_tag BYTEA,
  expires_at TIMESTAMPTZ,
  key_version SMALLINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (octet_length(access_token_iv) = 12),
  CHECK (octet_length(access_token_auth_tag) = 16),
  CHECK (refresh_token_iv IS NULL OR octet_length(refresh_token_iv) = 12),
  CHECK (refresh_token_auth_tag IS NULL OR octet_length(refresh_token_auth_tag) = 16),
  CHECK (
    (refresh_token_ciphertext IS NULL AND refresh_token_iv IS NULL AND refresh_token_auth_tag IS NULL)
    OR
    (refresh_token_ciphertext IS NOT NULL AND refresh_token_iv IS NOT NULL AND refresh_token_auth_tag IS NOT NULL)
  ),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES integration_connections(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  provider TEXT NOT NULL,
  resource TEXT NOT NULL CHECK (resource IN ('orders', 'ad_performance_daily', 'social_account_daily_metrics', 'content_performance_snapshots')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  idempotency_key TEXT NOT NULL,
  cursor_before TEXT,
  cursor_after TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  records_received INTEGER NOT NULL DEFAULT 0,
  records_inserted INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message_safe TEXT,
  requested_by TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_start < period_end),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES integration_connections(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX sync_jobs_queue_idx ON sync_jobs(status, run_after, created_at);
CREATE INDEX sync_jobs_workspace_idx ON sync_jobs(workspace_id, created_at DESC);

CREATE TABLE sync_cursors (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  resource TEXT NOT NULL,
  cursor_value TEXT,
  last_successful_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, connection_id, resource),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES integration_connections(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID,
  provider TEXT NOT NULL CHECK (provider IN ('scalev', 'lynk_id', 'manual')),
  external_order_id TEXT NOT NULL,
  placed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'failed')),
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  gross_amount NUMERIC(18,2) NOT NULL CHECK (gross_amount >= 0),
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  refund_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  net_amount NUMERIC(18,2) NOT NULL CHECK (net_amount >= 0),
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  external_campaign_id TEXT,
  internal_campaign_id TEXT,
  payload_hash TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, external_order_id),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES integration_connections(workspace_id, id) ON DELETE SET NULL (connection_id)
);
CREATE INDEX orders_workspace_date_idx ON orders(workspace_id, placed_at DESC);
CREATE INDEX orders_workspace_campaign_idx ON orders(workspace_id, internal_campaign_id);

CREATE TABLE ad_performance_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta_ads')),
  metric_date DATE NOT NULL,
  external_account_id TEXT NOT NULL,
  external_campaign_id TEXT NOT NULL DEFAULT '',
  external_adset_id TEXT NOT NULL DEFAULT '',
  external_ad_id TEXT NOT NULL DEFAULT '',
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  spend NUMERIC(18,2),
  impressions BIGINT,
  reach BIGINT,
  clicks BIGINT,
  landing_page_views BIGINT,
  add_to_cart BIGINT,
  checkouts_initiated BIGINT,
  purchases NUMERIC(18,4),
  attributed_revenue NUMERIC(18,2),
  attribution_window TEXT NOT NULL DEFAULT 'unspecified',
  payload_hash TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, external_account_id, metric_date, external_campaign_id, external_adset_id, external_ad_id, attribution_window),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES integration_connections(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX ad_performance_workspace_date_idx ON ad_performance_daily(workspace_id, metric_date DESC);

CREATE TABLE social_account_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('instagram', 'tiktok', 'youtube')),
  metric_date DATE NOT NULL,
  external_account_id TEXT NOT NULL,
  followers_total BIGINT,
  followers_gained BIGINT,
  followers_lost BIGINT,
  reach BIGINT,
  impressions BIGINT,
  profile_views BIGINT,
  website_clicks BIGINT,
  engagement_count BIGINT,
  video_views BIGINT,
  payload_hash TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, external_account_id, metric_date),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES integration_connections(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX social_metrics_workspace_date_idx ON social_account_daily_metrics(workspace_id, metric_date DESC);

CREATE TABLE content_performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('instagram', 'tiktok', 'youtube')),
  metric_date DATE NOT NULL,
  external_account_id TEXT NOT NULL,
  external_content_id TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  content_type TEXT,
  permalink TEXT,
  views BIGINT,
  reach BIGINT,
  impressions BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT,
  watch_time_seconds NUMERIC(18,2),
  average_watch_time_seconds NUMERIC(18,2),
  payload_hash TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, external_account_id, external_content_id, metric_date),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES integration_connections(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX content_metrics_workspace_date_idx ON content_performance_snapshots(workspace_id, metric_date DESC);

CREATE TABLE source_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES integration_connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('order', 'ad_performance_daily', 'social_account_daily_metrics', 'content_performance_snapshots')),
  entity_id UUID NOT NULL,
  source_record_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  import_job_id UUID REFERENCES sync_jobs(id) ON DELETE SET NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  validation_state TEXT NOT NULL CHECK (validation_state IN ('valid', 'incomplete', 'rejected', 'unverified')),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES integration_connections(workspace_id, id) ON DELETE SET NULL (connection_id)
);
CREATE INDEX source_lineage_entity_idx ON source_lineage(workspace_id, entity_type, entity_id);
CREATE UNIQUE INDEX source_lineage_connected_record_unique
  ON source_lineage(workspace_id, provider, connection_id, source_record_id)
  WHERE connection_id IS NOT NULL;
CREATE UNIQUE INDEX source_lineage_manual_record_unique
  ON source_lineage(workspace_id, provider, source_record_id)
  WHERE connection_id IS NULL;

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_logs_workspace_time_idx ON audit_logs(workspace_id, created_at DESC);


-- The application role is deliberately not the table owner. Create nexus_app
-- before applying this migration; run migrations as nexus_migrator.
GRANT USAGE ON SCHEMA public TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexus_app;

GRANT USAGE ON SCHEMA nexus_private TO nexus_app;
REVOKE ALL ON FUNCTION nexus_private.is_workspace_member(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION nexus_private.workspace_role(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION nexus_private.workspace_created_by(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexus_private.is_workspace_member(TEXT, UUID) TO nexus_app;
GRANT EXECUTE ON FUNCTION nexus_private.workspace_role(TEXT, UUID) TO nexus_app;
GRANT EXECUTE ON FUNCTION nexus_private.workspace_created_by(TEXT, UUID) TO nexus_app;

-- Workspace membership helpers are SECURITY DEFINER and must remain owned by the migration role.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspaces_select_member ON workspaces
  FOR SELECT USING (nexus_private.is_workspace_member(NULLIF(current_setting('nexus.user_id', TRUE), ''), id));
CREATE POLICY workspaces_insert_self ON workspaces
  FOR INSERT WITH CHECK (created_by = NULLIF(current_setting('nexus.user_id', TRUE), ''));
CREATE POLICY workspaces_update_admin ON workspaces
  FOR UPDATE USING (nexus_private.workspace_role(NULLIF(current_setting('nexus.user_id', TRUE), ''), id) IN ('owner', 'admin'))
  WITH CHECK (nexus_private.workspace_role(NULLIF(current_setting('nexus.user_id', TRUE), ''), id) IN ('owner', 'admin'));

CREATE POLICY workspace_members_select_scope ON workspace_members
  FOR SELECT USING (
    user_id = NULLIF(current_setting('nexus.user_id', TRUE), '')
    OR nexus_private.is_workspace_member(NULLIF(current_setting('nexus.user_id', TRUE), ''), workspace_id)
  );
CREATE POLICY workspace_members_insert_owner ON workspace_members
  FOR INSERT WITH CHECK (
    (
      user_id = NULLIF(current_setting('nexus.user_id', TRUE), '')
      AND role = 'owner'
      AND nexus_private.workspace_created_by(NULLIF(current_setting('nexus.user_id', TRUE), ''), workspace_id)
    )
    OR nexus_private.workspace_role(NULLIF(current_setting('nexus.user_id', TRUE), ''), workspace_id) = 'owner'
  );
CREATE POLICY workspace_members_update_owner ON workspace_members
  FOR UPDATE USING (nexus_private.workspace_role(NULLIF(current_setting('nexus.user_id', TRUE), ''), workspace_id) = 'owner')
  WITH CHECK (nexus_private.workspace_role(NULLIF(current_setting('nexus.user_id', TRUE), ''), workspace_id) = 'owner');
CREATE POLICY workspace_members_delete_owner ON workspace_members
  FOR DELETE USING (nexus_private.workspace_role(NULLIF(current_setting('nexus.user_id', TRUE), ''), workspace_id) = 'owner');

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'integration_connections',
    'integration_secrets',
    'sync_jobs',
    'sync_cursors',
    'orders',
    'ad_performance_daily',
    'social_account_daily_metrics',
    'content_performance_snapshots',
    'source_lineage',
    'audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_scope ON %I USING (
        workspace_id = NULLIF(current_setting(''nexus.workspace_id'', TRUE), '''')::uuid
        AND nexus_private.is_workspace_member(NULLIF(current_setting(''nexus.user_id'', TRUE), ''''), workspace_id)
      ) WITH CHECK (
        workspace_id = NULLIF(current_setting(''nexus.workspace_id'', TRUE), '''')::uuid
        AND nexus_private.is_workspace_member(NULLIF(current_setting(''nexus.user_id'', TRUE), ''''), workspace_id)
      )',
      table_name
    );
  END LOOP;
END $$;
