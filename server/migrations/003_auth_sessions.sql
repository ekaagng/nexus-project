SET LOCAL search_path TO public;

-- Short-lived OIDC transactions. PKCE verifiers are encrypted by the API and
-- deleted atomically on callback; the browser only receives the matching state.
CREATE TABLE public.auth_login_transactions (
  state_hash TEXT PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash TEXT NOT NULL CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  code_verifier_envelope JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX auth_login_transactions_expiry_idx
  ON public.auth_login_transactions(expires_at);

-- Opaque browser sessions. The raw cookie value is never persisted.
CREATE TABLE public.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_hash TEXT NOT NULL UNIQUE CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  user_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_active_idx
  ON public.auth_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

-- Identity/session events are separate from workspace audit events because a
-- user may not yet belong to a workspace when they first authenticate.
CREATE TABLE public.auth_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id UUID REFERENCES public.auth_sessions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('login.succeeded', 'logout', 'session.revoked', 'sessions.revoked')
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX auth_security_events_user_time_idx
  ON public.auth_security_events(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.auth_login_transactions, public.auth_sessions, public.auth_security_events
  TO nexus_app;
