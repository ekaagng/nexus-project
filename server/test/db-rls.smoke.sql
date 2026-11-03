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

-- Tenant C exercises reserved invitations and acceptance.
SELECT set_config('nexus.user_id', 'ci-user-c', TRUE);
INSERT INTO public.workspaces (id, name, created_by)
VALUES ('30000000-0000-4000-8000-000000000003', 'CI Workspace C', 'ci-user-c');
INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES ('30000000-0000-4000-8000-000000000003', 'ci-user-c', 'owner', 'active');
SELECT set_config('nexus.workspace_id', '30000000-0000-4000-8000-000000000003', TRUE);

INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES
  ('30000000-0000-4000-8000-000000000003', 'invite:30000000-0000-4000-8000-000000000001', 'member', 'invited'),
  ('30000000-0000-4000-8000-000000000003', 'invite:30000000-0000-4000-8000-000000000002', 'member', 'invited'),
  ('30000000-0000-4000-8000-000000000003', 'invite:30000000-0000-4000-8000-000000000003', 'member', 'invited'),
  ('30000000-0000-4000-8000-000000000003', 'invite:30000000-0000-4000-8000-000000000004', 'member', 'invited');

INSERT INTO public.workspace_invitations (
  id, workspace_id, email, role, status, token_hash, reserved_user_id, invited_by
) VALUES
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'invitee@example.com', 'member', 'pending', repeat('a', 64), 'invite:30000000-0000-4000-8000-000000000001', 'ci-user-c'),
  ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'second@example.com', 'member', 'pending', repeat('b', 64), 'invite:30000000-0000-4000-8000-000000000002', 'ci-user-c'),
  ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'third@example.com', 'member', 'pending', repeat('c', 64), 'invite:30000000-0000-4000-8000-000000000003', 'ci-user-c'),
  ('30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', 'fourth@example.com', 'member', 'pending', repeat('d', 64), 'invite:30000000-0000-4000-8000-000000000004', 'ci-user-c');

DO $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    VALUES ('30000000-0000-4000-8000-000000000003', 'invite:30000000-0000-4000-8000-000000000005', 'member', 'invited');
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Four active invitations plus the Owner must reserve all five seats';
  END IF;
END;
$$;

-- An invitation cannot be accepted by an account with a different verified email.
DO $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM nexus_private.accept_workspace_invitation(repeat('b', 64), 'ci-wrong-user', 'wrong@example.com');
  EXCEPTION WHEN raise_exception THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'An invitation was accepted with a mismatched email';
  END IF;
END;
$$;

SELECT nexus_private.accept_workspace_invitation(repeat('a', 64), 'ci-invited-member', 'invitee@example.com');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = '30000000-0000-4000-8000-000000000003'
      AND user_id = 'ci-invited-member'
      AND role = 'member'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Invitation acceptance did not activate the reserved membership';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_invitations
    WHERE id = '30000000-0000-4000-8000-000000000001'
      AND status = 'accepted'
      AND reserved_user_id = 'ci-invited-member'
  ) THEN
    RAISE EXCEPTION 'Accepted invitation was not linked to the real member identity';
  END IF;
END;
$$;

-- A previously revoked Member can be re-invited without consuming an extra seat.
UPDATE public.workspace_members
   SET status = 'revoked'
 WHERE workspace_id = '30000000-0000-4000-8000-000000000003'
   AND user_id = 'ci-invited-member';

INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES ('30000000-0000-4000-8000-000000000003', 'invite:30000000-0000-4000-8000-000000000005', 'member', 'invited');
INSERT INTO public.workspace_invitations (
  id, workspace_id, email, role, status, token_hash, reserved_user_id, invited_by
) VALUES (
  '30000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000003',
  'invitee@example.com',
  'member',
  'pending',
  repeat('e', 64),
  'invite:30000000-0000-4000-8000-000000000005',
  'ci-user-c'
);
SELECT nexus_private.accept_workspace_invitation(repeat('e', 64), 'ci-invited-member', 'invitee@example.com');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = '30000000-0000-4000-8000-000000000003'
      AND user_id = 'ci-invited-member'
      AND role = 'member'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'A previously revoked Member could not rejoin';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = '30000000-0000-4000-8000-000000000003'
      AND user_id = 'invite:30000000-0000-4000-8000-000000000005'
      AND status = 'revoked'
  ) THEN
    RAISE EXCEPTION 'The replacement invitation did not release its reserved seat';
  END IF;
END;
$$;

-- Member accounts cannot enumerate Owner-only invitations.
SELECT set_config('nexus.user_id', 'ci-invited-member', TRUE);
DO $$
DECLARE visible_invitations INTEGER;
BEGIN
  SELECT COUNT(*) INTO visible_invitations
    FROM public.workspace_invitations
   WHERE workspace_id = '30000000-0000-4000-8000-000000000003';
  IF visible_invitations <> 0 THEN
    RAISE EXCEPTION 'A regular Member can read workspace invitations';
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

-- Runtime-role session persistence and revocation permissions.
INSERT INTO public.auth_sessions (session_hash, user_id, issuer, email, email_verified, expires_at)
VALUES (repeat('f', 64), 'ci-user-a', 'https://identity.example.com', 'ci-user-a@example.com', TRUE, NOW() + INTERVAL '1 hour');

INSERT INTO public.auth_security_events (user_id, event_type)
VALUES ('ci-user-a', 'login.succeeded');

UPDATE public.auth_sessions
   SET revoked_at = NOW()
 WHERE session_hash = repeat('f', 64)
   AND user_id = 'ci-user-a';

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.auth_sessions
    WHERE session_hash = repeat('f', 64)
      AND revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Runtime role could not persist/revoke a browser session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auth_security_events
    WHERE user_id = 'ci-user-a'
      AND event_type = 'login.succeeded'
  ) THEN
    RAISE EXCEPTION 'Runtime role could not write authentication audit events';
  END IF;
END;
$;

ROLLBACK;
