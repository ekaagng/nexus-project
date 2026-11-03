import React, { useCallback, useEffect, useState } from 'react';
import {
  apiRequest,
  ApiError,
  WorkspaceInvitation,
  WorkspaceMember,
  workspaceHeaders
} from './api';

type InviteResponse = {
  invitation: WorkspaceInvitation;
  invitationToken: string;
  delivery: 'manual';
};

function describeError(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Permintaan tidak dapat diselesaikan.';
}

function dateLabel(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date(value));
}

export function AccessManagement({ workspaceId }: { workspaceId: string }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [email, setEmail] = useState('');
  const [oneTimeToken, setOneTimeToken] = useState('');
  const [tokenEmail, setTokenEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = workspaceHeaders(workspaceId);
      const [memberResult, invitationResult] = await Promise.all([
        apiRequest<{ members: WorkspaceMember[] }>('/api/v1/workspaces/members', { headers }),
        apiRequest<{ invitations: WorkspaceInvitation[] }>('/api/v1/workspaces/invitations', { headers })
      ]);
      setMembers(memberResult.members);
      setInvitations(invitationResult.invitations);
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingInvitations = invitations.filter(item => item.status === 'pending');
  const activeMembers = members.filter(item => item.status === 'active');
  const seatsUsed = activeMembers.length + pendingInvitations.length;
  const seatsRemaining = Math.max(0, 5 - seatsUsed);

  const sendInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setOneTimeToken('');
    try {
      const result = await apiRequest<InviteResponse>('/api/v1/workspaces/invitations', {
        method: 'POST',
        headers: workspaceHeaders(workspaceId),
        body: { email: email.trim().toLowerCase() }
      });
      setOneTimeToken(result.invitationToken);
      setTokenEmail(result.invitation.email);
      setEmail('');
      setNotice('Undangan dibuat. Token ini hanya ditampilkan sekali.');
      await load();
    } catch (inviteError) {
      setError(describeError(inviteError));
    } finally {
      setBusy(false);
    }
  };

  const revokeInvitation = async (invitation: WorkspaceInvitation) => {
    if (!window.confirm('Cabut undangan untuk ' + invitation.email + '? Kursi yang dipesan akan dilepas.')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/v1/workspaces/invitations/' + encodeURIComponent(invitation.id), {
        method: 'DELETE',
        headers: workspaceHeaders(workspaceId)
      });
      setNotice('Undangan berhasil dicabut.');
      await load();
    } catch (revokeError) {
      setError(describeError(revokeError));
    } finally {
      setBusy(false);
    }
  };

  const revokeMember = async (member: WorkspaceMember) => {
    const identity = member.email || member.user_id;
    if (!window.confirm('Cabut akses ' + identity + ' dari workspace? Tindakan ini tidak dapat dibatalkan dari halaman ini.')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/v1/workspaces/members/' + encodeURIComponent(member.user_id), {
        method: 'DELETE',
        headers: workspaceHeaders(workspaceId)
      });
      setNotice('Akses member berhasil dicabut.');
      await load();
    } catch (revokeError) {
      setError(describeError(revokeError));
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!oneTimeToken) return;
    try {
      await navigator.clipboard.writeText(oneTimeToken);
      setNotice('Token undangan disalin.');
    } catch {
      setError('Clipboard tidak tersedia. Pilih token pada kolom lalu salin secara manual.');
    }
  };

  return (
    <div className="access-management">
      <div className="access-intro">
        <div>
          <span className="eyebrow">OWNER-ONLY · PRIVATE WORKSPACE</span>
          <h2>Access management</h2>
          <p>Kelola siapa yang dapat masuk ke workspace ini. Hanya Owner yang dapat mengundang atau mencabut akses.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading || busy}>
          Refresh <span aria-hidden="true">↻</span>
        </button>
      </div>

      <div className="access-seat-grid">
        <div><span>Reserved seats</span><strong>{seatsUsed} <small>/ 5</small></strong></div>
        <div><span>Active members</span><strong>{activeMembers.length}</strong></div>
        <div><span>Pending invitations</span><strong>{pendingInvitations.length}</strong></div>
        <div><span>Available seats</span><strong>{seatsRemaining}</strong></div>
      </div>

      {error && <div className="notice notice-warning" role="alert">{error}</div>}
      {notice && <div className="notice notice-info" role="status">{notice}</div>}

      {oneTimeToken && (
        <section className="one-time-token" aria-labelledby="token-title">
          <div>
            <span className="eyebrow">ONE-TIME SECRET</span>
            <h3 id="token-title">Invitation created for {tokenEmail}</h3>
            <p>Salin dan kirim melalui kanal tepercaya. NEXUS tidak mengirim email undangan. Tutup panel ini setelah token disimpan karena token tidak dapat dilihat kembali.</p>
          </div>
          <label className="field">
            <span>Invitation token</span>
            <textarea value={oneTimeToken} readOnly rows={3} onFocus={event => event.currentTarget.select()} />
          </label>
          <div className="access-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void copyToken()}>Copy token</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setOneTimeToken(''); setTokenEmail(''); }}>Close token</button>
          </div>
        </section>
      )}

      <div className="access-columns">
        <section className="panel access-panel">
          <div className="panel-head">
            <div><h3>Authorized members</h3><small>{activeMembers.length} active accounts</small></div>
          </div>
          {loading ? (
            <p className="access-state" role="status">Loading members…</p>
          ) : activeMembers.length === 0 ? (
            <p className="access-state">Belum ada anggota aktif.</p>
          ) : (
            <div className="access-list">
              {activeMembers.map(member => (
                <div className="access-list-row" key={member.user_id}>
                  <span className="access-member-avatar">{(member.email || member.user_id).slice(0, 1).toUpperCase()}</span>
                  <div className="access-member-copy">
                    <strong>{member.email || 'Account ' + member.user_id.slice(0, 12)}</strong>
                    <small>{member.role === 'owner' ? 'Owner · Protected' : 'Member'} · Added {dateLabel(member.created_at)}</small>
                  </div>
                  <span className={'access-role ' + member.role}>{member.role}</span>
                  {member.role === 'member' && (
                    <button type="button" className="text-btn danger-text" onClick={() => void revokeMember(member)} disabled={busy}>
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel access-panel">
          <div className="panel-head">
            <div><h3>Invite a member</h3><small>Member role · Seven-day expiry</small></div>
          </div>
          <form className="access-invite-form" onSubmit={sendInvite}>
            <label className="field">
              <span>Email address</span>
              <input type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="member@company.com" required />
            </label>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || seatsRemaining === 0 || !email.trim()}>
              {busy ? 'Processing…' : seatsRemaining === 0 ? 'Workspace full' : 'Create invitation'}
            </button>
          </form>
          <p className="access-footnote">Undangan akan memesan satu dari lima kursi sampai diterima, dicabut, atau kedaluwarsa.</p>
          <div className="invitation-list-head"><strong>Invitation history</strong><span>{invitations.length}</span></div>
          {loading ? (
            <p className="access-state">Loading invitations…</p>
          ) : invitations.length === 0 ? (
            <p className="access-state">Belum ada undangan.</p>
          ) : (
            <div className="invitation-list">
              {invitations.map(invitation => (
                <div className="invitation-row" key={invitation.id}>
                  <div>
                    <strong>{invitation.email}</strong>
                    <small>{invitation.status} · Expires {dateLabel(invitation.expires_at)}</small>
                  </div>
                  <span className={'invitation-status ' + invitation.status}>{invitation.status}</span>
                  {invitation.status === 'pending' && (
                    <button type="button" className="text-btn danger-text" onClick={() => void revokeInvitation(invitation)} disabled={busy}>Revoke</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
