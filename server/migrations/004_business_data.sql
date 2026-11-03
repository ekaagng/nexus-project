SET LOCAL search_path TO public;

CREATE TABLE public.campaigns (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  objective TEXT NOT NULL CHECK (length(trim(objective)) BETWEEN 1 AND 80),
  owner TEXT NOT NULL CHECK (length(trim(owner)) BETWEEN 1 AND 120),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  target_revenue NUMERIC(18,2) NOT NULL CHECK (target_revenue >= 0),
  planned_budget NUMERIC(18,2) NOT NULL CHECK (planned_budget >= 0),
  status TEXT NOT NULL CHECK (length(trim(status)) BETWEEN 1 AND 40),
  channels TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id),
  CHECK (start_date < end_date)
);
CREATE INDEX campaigns_workspace_dates_idx ON public.campaigns(workspace_id, start_date, end_date);
CREATE INDEX campaigns_workspace_updated_idx ON public.campaigns(workspace_id, updated_at DESC);

CREATE TABLE public.briefs (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 80),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  type TEXT NOT NULL CHECK (length(trim(type)) BETWEEN 1 AND 40),
  campaign_id TEXT,
  status TEXT NOT NULL CHECK (length(trim(status)) BETWEEN 1 AND 40),
  owner TEXT NOT NULL CHECK (length(trim(owner)) BETWEEN 1 AND 120),
  updated_on DATE NOT NULL,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES public.campaigns(workspace_id, id) ON DELETE SET NULL (campaign_id)
);
CREATE INDEX briefs_workspace_updated_idx ON public.briefs(workspace_id, updated_at DESC);

CREATE TABLE public.tasks (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 80),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description TEXT,
  assignee TEXT NOT NULL CHECK (length(trim(assignee)) BETWEEN 1 AND 120),
  priority TEXT NOT NULL CHECK (length(trim(priority)) BETWEEN 1 AND 30),
  status TEXT NOT NULL CHECK (length(trim(status)) BETWEEN 1 AND 40),
  due_date DATE NOT NULL,
  owner TEXT,
  campaign_id TEXT,
  kind TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES public.campaigns(workspace_id, id) ON DELETE SET NULL (campaign_id)
);
CREATE INDEX tasks_workspace_due_idx ON public.tasks(workspace_id, due_date, status);
CREATE INDEX tasks_workspace_updated_idx ON public.tasks(workspace_id, updated_at DESC);

CREATE TABLE public.content_items (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 80),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  platform TEXT NOT NULL CHECK (length(trim(platform)) BETWEEN 1 AND 40),
  pillar TEXT NOT NULL CHECK (length(trim(pillar)) BETWEEN 1 AND 100),
  format TEXT NOT NULL CHECK (length(trim(format)) BETWEEN 1 AND 80),
  hook TEXT NOT NULL CHECK (length(trim(hook)) BETWEEN 1 AND 500),
  cta TEXT NOT NULL CHECK (length(trim(cta)) BETWEEN 1 AND 300),
  owner TEXT NOT NULL CHECK (length(trim(owner)) BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK (length(trim(status)) BETWEEN 1 AND 40),
  publish_date DATE NOT NULL,
  campaign_id TEXT,
  views BIGINT CHECK (views IS NULL OR views >= 0),
  engagement NUMERIC(8,3) CHECK (engagement IS NULL OR engagement >= 0),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES public.campaigns(workspace_id, id) ON DELETE SET NULL (campaign_id)
);
CREATE INDEX content_items_workspace_publish_idx ON public.content_items(workspace_id, publish_date DESC);
CREATE INDEX content_items_workspace_updated_idx ON public.content_items(workspace_id, updated_at DESC);

CREATE TABLE public.budget_expenses (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 80),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  category TEXT NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 80),
  vendor TEXT NOT NULL CHECK (length(trim(vendor)) BETWEEN 1 AND 160),
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  expense_date DATE NOT NULL,
  campaign_id TEXT,
  channel TEXT NOT NULL CHECK (length(trim(channel)) BETWEEN 1 AND 80),
  type TEXT NOT NULL CHECK (type IN ('actual', 'committed')),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES public.campaigns(workspace_id, id) ON DELETE SET NULL (campaign_id)
);
CREATE INDEX budget_expenses_workspace_date_idx ON public.budget_expenses(workspace_id, expense_date DESC);
CREATE INDEX budget_expenses_workspace_campaign_idx ON public.budget_expenses(workspace_id, campaign_id);

CREATE TABLE public.kols (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  platform TEXT NOT NULL CHECK (length(trim(platform)) BETWEEN 1 AND 40),
  handle TEXT NOT NULL CHECK (length(trim(handle)) BETWEEN 1 AND 120),
  instagram_url TEXT NOT NULL DEFAULT '',
  niche TEXT NOT NULL CHECK (length(trim(niche)) BETWEEN 1 AND 120),
  contact TEXT NOT NULL DEFAULT '',
  rate NUMERIC(18,2) NOT NULL CHECK (rate >= 0),
  stage TEXT NOT NULL CHECK (length(trim(stage)) BETWEEN 1 AND 40),
  campaign_id TEXT,
  publish_date DATE,
  notes TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES public.campaigns(workspace_id, id) ON DELETE SET NULL (campaign_id)
);
CREATE INDEX kols_workspace_stage_idx ON public.kols(workspace_id, stage);
CREATE INDEX kols_workspace_updated_idx ON public.kols(workspace_id, updated_at DESC);

CREATE TABLE public.experiments (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  hypothesis TEXT NOT NULL CHECK (length(trim(hypothesis)) BETWEEN 1 AND 2000),
  change_made TEXT NOT NULL CHECK (length(trim(change_made)) BETWEEN 1 AND 2000),
  primary_metric TEXT NOT NULL CHECK (length(trim(primary_metric)) BETWEEN 1 AND 160),
  success_criteria TEXT NOT NULL CHECK (length(trim(success_criteria)) BETWEEN 1 AND 1000),
  owner TEXT NOT NULL CHECK (length(trim(owner)) BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK (length(trim(status)) BETWEEN 1 AND 40),
  start_date DATE NOT NULL,
  end_date DATE,
  outcome TEXT,
  campaign_id TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES public.campaigns(workspace_id, id) ON DELETE SET NULL (campaign_id),
  CHECK (end_date IS NULL OR start_date <= end_date)
);
CREATE INDEX experiments_workspace_status_idx ON public.experiments(workspace_id, status);
CREATE INDEX experiments_workspace_updated_idx ON public.experiments(workspace_id, updated_at DESC);

CREATE TABLE public.competitors (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  platform TEXT NOT NULL CHECK (length(trim(platform)) BETWEEN 1 AND 40),
  handle TEXT NOT NULL CHECK (length(trim(handle)) BETWEEN 1 AND 120),
  url TEXT NOT NULL CHECK (length(trim(url)) BETWEEN 1 AND 2048),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (length(trim(status)) BETWEEN 1 AND 40),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX competitors_workspace_status_idx ON public.competitors(workspace_id, status);

CREATE TABLE public.competitor_posts (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 80),
  competitor_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  url TEXT NOT NULL CHECK (length(trim(url)) BETWEEN 1 AND 2048),
  observed_at DATE NOT NULL,
  views BIGINT CHECK (views IS NULL OR views >= 0),
  likes BIGINT CHECK (likes IS NULL OR likes >= 0),
  comments BIGINT CHECK (comments IS NULL OR comments >= 0),
  shares BIGINT CHECK (shares IS NULL OR shares >= 0),
  format TEXT NOT NULL CHECK (length(trim(format)) BETWEEN 1 AND 80),
  hook TEXT NOT NULL CHECK (length(trim(hook)) BETWEEN 1 AND 500),
  angle TEXT NOT NULL CHECK (length(trim(angle)) BETWEEN 1 AND 300),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, competitor_id)
    REFERENCES public.competitors(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX competitor_posts_workspace_observed_idx ON public.competitor_posts(workspace_id, observed_at DESC);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'campaigns',
    'briefs',
    'tasks',
    'content_items',
    'budget_expenses',
    'kols',
    'experiments',
    'competitors',
    'competitor_posts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY business_data_workspace_scope ON public.%I
       USING (
         workspace_id = NULLIF(current_setting(''nexus.workspace_id'', TRUE), '''')::uuid
         AND nexus_private.is_workspace_member(NULLIF(current_setting(''nexus.user_id'', TRUE), ''''), workspace_id)
       )
       WITH CHECK (
         workspace_id = NULLIF(current_setting(''nexus.workspace_id'', TRUE), '''')::uuid
         AND nexus_private.is_workspace_member(NULLIF(current_setting(''nexus.user_id'', TRUE), ''''), workspace_id)
       )',
      table_name
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.campaigns,
  public.briefs,
  public.tasks,
  public.content_items,
  public.budget_expenses,
  public.kols,
  public.experiments,
  public.competitors,
  public.competitor_posts
TO nexus_app;
