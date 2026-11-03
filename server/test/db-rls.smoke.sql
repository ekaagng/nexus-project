BEGIN;

-- Tenant A: create workspace and owner under the application role/RLS.
SELECT set_config('nexus.user_id', 'ci-user-a', TRUE);
INSERT INTO public.workspaces (id, name, created_by)
VALUES ('10000000-0000-4000-8000-000000000001', 'CI Workspace A', 'ci-user-a');
INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES ('10000000-0000-4000-8000-000000000001', 'ci-user-a', 'owner', 'active');
SELECT set_config('nexus.workspace_id', '10000000-0000-4000-8000-000000000001', TRUE);

-- Owner may add four more seats. Active + invited seats are capped at five.
INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'ci-member-2', 'member', 'active'),
  ('10000000-0000-4000-8000-000000000001', 'ci-member-3', 'member', 'active'),
  ('10000000-0000-4000-8000-000000000001', 'ci-member-4', 'member', 'active'),
  ('10000000-0000-4000-8000-000000000001', 'ci-member-5', 'member', 'active');

DO $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    VALUES ('10000000-0000-4000-8000-000000000001', 'ci-member-6', 'member', 'invited');
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'The six-seat workspace insertion was not rejected';
  END IF;
END;
$$;

-- The initial owner cannot be revoked/demoted through normal workspace operations.
DO $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE public.workspace_members
       SET status = 'revoked'
     WHERE workspace_id = '10000000-0000-4000-8000-000000000001'
       AND user_id = 'ci-user-a';
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'The initial workspace owner was mutable';
  END IF;
END;
$$;

-- Tenant B is created by a different user.
SELECT set_config('nexus.user_id', 'ci-user-b', TRUE);
INSERT INTO public.workspaces (id, name, created_by)
VALUES ('20000000-0000-4000-8000-000000000002', 'CI Workspace B', 'ci-user-b');
INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES ('20000000-0000-4000-8000-000000000002', 'ci-user-b', 'owner', 'active');

-- Tenant A cannot read or write tenant B data, even when it supplies tenant B's ID.
SELECT set_config('nexus.user_id', 'ci-user-a', TRUE);
SELECT set_config('nexus.workspace_id', '20000000-0000-4000-8000-000000000002', TRUE);

DO $$
DECLARE visible_members INTEGER;
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  SELECT COUNT(*) INTO visible_members
  FROM public.workspace_members
  WHERE workspace_id = '20000000-0000-4000-8000-000000000002';

  IF visible_members <> 0 THEN
    RAISE EXCEPTION 'Tenant A can read tenant B workspace members';
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (workspace_id, actor_user_id, action)
    VALUES ('20000000-0000-4000-8000-000000000002', 'ci-user-a', 'cross-tenant-write-test');
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := TRUE;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'Tenant A cross-tenant write was not rejected';
  END IF;
END;
$$;

ROLLBACK;
