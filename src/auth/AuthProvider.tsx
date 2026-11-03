import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  acceptWorkspaceInvitation,
  ApiError,
  AuthSession,
  apiRequest,
  beginOidcLogin,
  createWorkspace,
  getCurrentSession,
  getOidcStatus,
  getWorkspaces,
  WorkspaceSummary
} from './api';

type AuthContextValue = {
  session: AuthSession;
  signOut: () => Promise<void>;
};

type WorkspaceContextValue = {
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceSummary;
  selectWorkspace: (id: string) => void;
  refreshWorkspaces: () => Promise<WorkspaceSummary[]>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Terjadi kesalahan yang tidak diketahui.';
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider.');
  return value;
}

function FullScreenState({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-frame" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="brand-mark">N</span>
          <span><strong>NEXUS</strong><small>MARKETING INTELLIGENCE</small></span>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">{eyebrow}</span>
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>
        {children}
        <p className="auth-footnote">Private workspace · Server-verified access</p>
      </section>
    </main>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'anonymous' | 'error'>('checking');
  const [loginAvailable, setLoginAvailable] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const checkSession = useCallback(async () => {
    setStatus('checking');
    setErrorMessage('');
    try {
      const result = await getCurrentSession();
      setSession(result);
      setStatus('authenticated');
      setLoginAvailable(true);
      const url = new URL(window.location.href);
      if (url.searchParams.has('auth')) {
        url.searchParams.delete('auth');
        window.history.replaceState({}, document.title, url.toString());
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(null);
        try {
          const readiness = await getOidcStatus();
          setLoginAvailable(readiness.loginAvailable);
          setStatus('anonymous');
        } catch (statusError) {
          setErrorMessage(messageFor(statusError));
          setStatus('error');
        }
        return;
      }
      setErrorMessage(messageFor(error));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const signOut = useCallback(async () => {
    try {
      await fetch(
        (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') + '/api/v1/auth/logout',
        { method: 'POST', credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' } }
      );
    } finally {
      setSession(null);
      setStatus('anonymous');
      try {
        const readiness = await getOidcStatus();
        setLoginAvailable(readiness.loginAvailable);
      } catch {
        setLoginAvailable(false);
      }
    }
  }, []);

  if (status === 'checking') {
    return (
      <FullScreenState eyebrow="SECURE SESSION" title="Checking access" description="Memeriksa sesi aktif ke NEXUS API.">
        <div className="auth-progress" role="status"><span /> Connecting to workspace service</div>
      </FullScreenState>
    );
  }

  if (status === 'error') {
    return (
      <FullScreenState eyebrow="CONNECTION ERROR" title="NEXUS API tidak tersedia" description={errorMessage}>
        <div className="auth-actions">
          <button className="btn btn-primary btn-block" onClick={() => void checkSession()}>Try again</button>
        </div>
      </FullScreenState>
    );
  }

  if (status === 'anonymous') {
    return (
      <FullScreenState
        eyebrow="IDENTITY REQUIRED"
        title="Sign in to NEXUS"
        description="Gunakan akun yang terdaftar pada identity provider workspace. Akun baru tidak otomatis mendapat akses ke workspace."
      >
        <div className="auth-actions">
          <button className="btn btn-primary btn-block" onClick={beginOidcLogin} disabled={!loginAvailable}>
            Continue with identity provider <span aria-hidden="true">→</span>
          </button>
          {!loginAvailable && (
            <p className="auth-inline-error" role="status">
              Login belum aktif. Administrator perlu mengonfigurasi OIDC client, callback URL, dan encryption key pada server.
            </p>
          )}
          <button className="auth-retry" onClick={() => void checkSession()}>Check session again</button>
        </div>
      </FullScreenState>
    );
  }

  if (!session) return null;
  return <AuthContext.Provider value={{ session, signOut }}>{children}</AuthContext.Provider>;
}

function WorkspaceSetup({ onCreated }: { onCreated: (workspace: WorkspaceSummary) => void }) {
  const { session, signOut } = useAuth();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [workspaceName, setWorkspaceName] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (mode === 'create') {
        const workspace = await createWorkspace(workspaceName.trim());
        onCreated(workspace);
      } else {
        const result = await acceptWorkspaceInvitation(invitationToken.trim());
        if (result.accepted) {
          setSuccess('Undangan diterima. Memuat workspace…');
          onCreated({
            id: result.workspaceId,
            name: 'Workspace',
            timezone: 'Asia/Jakarta',
            currency: 'IDR',
            role: 'member',
            status: 'active',
            created_at: new Date().toISOString()
          });
        }
      }
    } catch (submitError) {
      setError(messageFor(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullScreenState
      eyebrow="WORKSPACE ACCESS"
      title="Belum ada workspace"
      description="Akun berhasil diverifikasi. Buat workspace baru sebagai Owner atau masukkan token undangan dari Owner."
    >
      <div className="workspace-setup">
        <div className="auth-tabs" role="tablist" aria-label="Workspace access method">
          <button type="button" role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'selected' : ''} onClick={() => { setMode('create'); setError(''); }}>Create workspace</button>
          <button type="button" role="tab" aria-selected={mode === 'join'} className={mode === 'join' ? 'selected' : ''} onClick={() => { setMode('join'); setError(''); }}>Join with invite</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'create' ? (
            <label className="field">
              <span>Workspace name</span>
              <input value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} minLength={2} maxLength={120} placeholder="e.g. Daytoday Marketing" required />
            </label>
          ) : (
            <label className="field">
              <span>Invitation token</span>
              <textarea value={invitationToken} onChange={event => setInvitationToken(event.target.value)} rows={3} placeholder="Paste the one-time token from your workspace Owner" required />
            </label>
          )}
          {error && <p className="auth-inline-error" role="alert">{error}</p>}
          {success && <p className="auth-inline-success" role="status">{success}</p>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || (mode === 'create' ? workspaceName.trim().length < 2 : invitationToken.trim().length < 20)}>
            {busy ? 'Processing…' : mode === 'create' ? 'Create workspace' : 'Accept invitation'}
          </button>
        </form>
        <div className="auth-user-line">
          <span>{session.user.email || session.user.id}</span>
          <button type="button" className="auth-retry" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>
    </FullScreenState>
  );
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshWorkspaces = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getWorkspaces();
      setWorkspaces(result);
      setSelectedId(current => result.some(item => item.id === current) ? current : result[0]?.id || '');
      return result;
    } catch (loadError) {
      setError(messageFor(loadError));
      throw loadError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWorkspaces().catch(() => undefined);
  }, [refreshWorkspaces, session.user.id]);

  const handleCreated = useCallback(async (created: WorkspaceSummary) => {
    const result = await getWorkspaces();
    setWorkspaces(result);
    setSelectedId(created.id);
  }, []);

  const workspace = workspaces.find(item => item.id === selectedId) || workspaces[0];
  const value = useMemo<WorkspaceContextValue | null>(() => workspace ? ({
    workspaces,
    workspace,
    selectWorkspace: setSelectedId,
    refreshWorkspaces
  }) : null, [workspaces, workspace, refreshWorkspaces]);

  if (loading) {
    return (
      <FullScreenState eyebrow="WORKSPACE" title="Loading workspace" description="Memuat daftar workspace dan hak akses akun.">
        <div className="auth-progress" role="status"><span /> Loading memberships</div>
      </FullScreenState>
    );
  }

  if (error) {
    return (
      <FullScreenState eyebrow="WORKSPACE ERROR" title="Workspace tidak dapat dimuat" description={error}>
        <button className="btn btn-primary btn-block" onClick={() => void refreshWorkspaces().catch(() => undefined)}>Retry</button>
      </FullScreenState>
    );
  }

  if (!workspaces.length || !workspace) {
    return <WorkspaceSetup onCreated={handleCreated} />;
  }

  if (!value) return null;
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
