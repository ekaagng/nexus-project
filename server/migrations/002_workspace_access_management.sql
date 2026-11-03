SET LOCAL search_path TO public;

CREATE TABLE public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (
    email = lower(email)
    AND length(email) BETWEEN 3 AND 254
  ),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role = 'member'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  token_hash TEXT NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  reserved_user_id TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  accepted_by TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, reserved_user_id),
  FOREIGN KEY (workspace_id, reserved_user_id)
    REFERENCES public.workspace_members(workspace_id, user_id) ON DELETE CASCADE,
  CHECK (
    (status = 'accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
    OR
    (status <> 'accepted' AND accepted_by IS NULL AND accepted_at IS NULL)
  ),
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR
    (status <> 'revoked' AND revoked_at IS NULL)
  )
);

CREATE UNIQUE INDEX workspace_invitations_one_pending_email_idx
  ON public.workspace_invitations(workspace_id, email)
  WHERE status = 'pending';
CREATE INDEX workspace_invitations_workspace_status_idx
  ON public.workspace_invitations(workspace_id, status, created_at DESC);

ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_invitations_owner_scope ON public.workspace_invitations
  FOR ALL
  USING (
    workspace_id = NULLIF(current_setting('nexus.workspace_id', TRUE), '')::uuid
    AND nexus_private.workspace_role(
      NULLIF(current_setting('nexus.user_id', TRUE), ''),
      workspace_id
    ) = 'owner'
  )
  WITH CHECK (
    workspace_id = NULLIF(current_setting('nexus.workspace_id', TRUE), '')::uuid
    AND nexus_private.workspace_role(
      NULLIF(current_setting('nexus.user_id', TRUE), ''),
      workspace_id
    ) = 'owner'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_invitations TO nexus_app;

CREATE OR REPLACE FUNCTION nexus_private.accept_workspace_invitation(
  p_token_hash TEXT,
  p_user_id TEXT,
  p_verified_email TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invitation RECORD;
BEGIN
  IF COALESCE(trim(p_user_id), '') = ''
     OR COALESCE(trim(p_verified_email), '') = ''
     OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'workspace_invitation_invalid_or_expired';
  END IF;

  -- Expired invitations release their reserved seat even when acceptance is attempted late.
  UPDATE public.workspace_invitations
     SET status = 'expired', updated_at = NOW()
   WHERE token_hash = p_token_hash
     AND status = 'pending'
     AND expires_at <= NOW()
  RETURNING workspace_id, reserved_user_id INTO invitation;

  IF FOUND THEN
    UPDATE public.workspace_members
       SET status = 'revoked', updated_at = NOW()
     WHERE workspace_id = invitation.workspace_id
       AND user_id = invitation.reserved_user_id
       AND status = 'invited';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'workspace_invitation_invalid_or_expired';
  END IF;

  SELECT i.workspace_id, i.reserved_user_id
    INTO invitation
    FROM public.workspace_invitations AS i
   WHERE i.token_hash = p_token_hash
     AND lower(i.email) = lower(trim(p_verified_email))
     AND i.status = 'pending'
     AND i.expires_at > NOW()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'workspace_invitation_invalid_or_expired';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.workspace_members AS wm
     WHERE wm.workspace_id = invitation.workspace_id
       AND wm.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'workspace_user_already_a_member';
  END IF;

  UPDATE public.workspace_members
     SET user_id = p_user_id,
         status = 'active',
         updated_at = NOW()
   WHERE workspace_id = invitation.workspace_id
     AND user_id = invitation.reserved_user_id
     AND role = 'member'
     AND status = 'invited';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'workspace_invitation_reservation_missing';
  END IF;

  UPDATE public.workspace_invitations
     SET status = 'accepted',
         accepted_by = p_user_id,
         accepted_at = NOW(),
         updated_at = NOW()
   WHERE token_hash = p_token_hash
     AND status = 'pending';

  INSERT INTO public.audit_logs (
    workspace_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    invitation.workspace_id,
    p_user_id,
    'workspace.invitation.accepted',
    'workspace_invitation',
    p_token_hash,
    jsonb_build_object('email', lower(trim(p_verified_email)), 'role', 'member')
  );

  RETURN invitation.workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION nexus_private.accept_workspace_invitation(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexus_private.accept_workspace_invitation(TEXT, TEXT, TEXT) TO nexus_app;
