import React, { useEffect, useState } from 'react';
import {
  apiRequest,
  ApiError,
  AuthUser,
  BrowserSession
} from './api';

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Permintaan gagal diproses.';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function SessionControls({
  user,
  role,
  workspaceName,
  onSignOut
}: {
  user: AuthUser;
  role: 'owner' | 'member';
  workspaceName: string;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const loadSessions = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest<{ sessions: BrowserSession[] }>('/api/v1/auth/sessions');
      setSessions(result.sessions);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadSessions();
  }, [open]);

  const revokeSession = async (session: BrowserSession) => {
    if (!window.confirm(session.current
      ? 'Cabut sesi ini? Anda akan keluar dari NEXUS pada perangkat ini.'
      : 'Cabut sesi pada perangkat ini?')) return;

    setBusyId(session.id);
    setError('');
    try {
      await apiRequest('/api/v1/auth/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' });
      if (session.current) {
        await onSignOut();
        return;
      }
      setSessions(current => current.filter(item => item.id !== session.id));
    } catch (revokeError) {
      setError(errorMessage(revokeError));
      if (revokeError instanceof ApiError && revokeError.status === 401) {
        await onSignOut().catch(() => undefined);
      }
    } finally {
      setBusyId('');
    }
  };

  const revokeAll = async () => {
    if (!window.confirm('Cabut semua sesi aktif pada seluruh perangkat? Tindakan ini akan mengeluarkan akun Anda dari perangkat ini juga.')) return;
    setBusyId('all');
    setError('');
    try {
      await apiRequest('/api/v1/auth/sessions/revoke-all', { method: 'POST' });
      await onSignOut();
    } catch (revokeError) {
      setError(errorMessage(revokeError));
    } finally {
      setBusyId('');
    }
  };

  const logout = async () => {
    setBusyId('logout');
    setError('');
    try {
      await onSignOut();
    } catch (logoutError) {
      setError(errorMessage(logoutError));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="account-menu">
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="account-avatar">{(user.email || user.id).slice(0, 1).toUpperCase()}</span>
        <span className="account-trigger-copy">
          <strong>{user.email || 'Authenticated user'}</strong>
          <small>{role === 'owner' ? 'Owner' : 'Member'} · {workspaceName}</small>
        </span>
        <span className="account-caret" aria-hidden="true">⌄</span>
      </button>

      {open && (
        <section className="account-popover" role="dialog" aria-label="Account and sessions">
          <div className="account-popover-head">
            <div>
              <span className="eyebrow">SIGNED IN AS</span>
              <strong>{user.email || user.id}</strong>
              <small>{user.emailVerified ? 'Verified email' : 'Email not verified'} · {role}</small>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close account menu">×</button>
          </div>

          <div className="session-section-head">
            <div><strong>Active sessions</strong><small>Server-verified browser sessions</small></div>
            <button type="button" className="text-btn" onClick={() => void loadSessions()} disabled={loading}>Refresh</button>
          </div>

          {loading && <p className="session-empty" role="status">Loading active sessions…</p>}
          {!loading && sessions.length === 0 && !error && <p className="session-empty">No active sessions found.</p>}
          {sessions.map(session => (
            <div className="session-row" key={session.id}>
              <div className="session-row-main">
                <strong>{session.current ? 'This device' : 'Browser session'}</strong>
                <small>Last active {formatDate(session.lastSeenAt)}</small>
                <small>Expires {formatDate(session.expiresAt)}</small>
              </div>
              <button
                type="button"
                className="text-btn danger-text"
                onClick={() => void revokeSession(session)}
                disabled={busyId === session.id || busyId === 'all'}
              >
                {busyId === session.id ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          ))}

          {error && <p className="auth-inline-error" role="alert">{error}</p>}
          <div className="account-actions">
            <button type="button" className="btn btn-ghost btn-block" onClick={() => void revokeAll()} disabled={busyId !== ''}>
              {busyId === 'all' ? 'Revoking sessions…' : 'Revoke all sessions'}
            </button>
            <button type="button" className="btn btn-primary btn-block" onClick={() => void logout()} disabled={busyId !== ''}>
              {busyId === 'logout' ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
