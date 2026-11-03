export type AuthUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  issuer: string;
};

export type AuthSession = {
  user: AuthUser;
  authentication: {
    method: 'session' | 'bearer';
    expiresAt: string | null;
  };
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  role: 'owner' | 'member';
  status: 'active';
  created_at: string;
};

export type BrowserSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

export type WorkspaceMember = {
  user_id: string;
  email?: string | null;
  role: 'owner' | 'member';
  status: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: 'member';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(API_BASE_URL + path, {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      redirect: 'follow'
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Tidak dapat terhubung ke NEXUS API. Periksa koneksi dan server API.');
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, 'invalid_api_response', 'API mengirim respons yang tidak dapat dibaca.');
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(
      response.status,
      error?.code || 'request_failed',
      error?.message || 'Permintaan tidak dapat diproses.'
    );
  }

  return payload as T;
}

export function beginOidcLogin(): void {
  window.location.assign(API_BASE_URL + '/api/v1/auth/oidc/start');
}

export async function getCurrentSession(signal?: AbortSignal): Promise<AuthSession> {
  return apiRequest<AuthSession>('/api/v1/auth/session', { signal });
}

export async function getOidcStatus(signal?: AbortSignal): Promise<{ loginAvailable: boolean }> {
  return apiRequest<{ loginAvailable: boolean }>('/api/v1/auth/oidc/status', { signal });
}

export async function getWorkspaces(signal?: AbortSignal): Promise<WorkspaceSummary[]> {
  const result = await apiRequest<{ workspaces: WorkspaceSummary[] }>('/api/v1/workspaces', { signal });
  return result.workspaces;
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const result = await apiRequest<{ workspace: WorkspaceSummary }>('/api/v1/workspaces', {
    method: 'POST',
    body: { name }
  });
  return result.workspace;
}

export async function acceptWorkspaceInvitation(token: string): Promise<{ accepted: boolean; workspaceId: string }> {
  return apiRequest('/api/v1/workspaces/invitations/accept', {
    method: 'POST',
    body: { token }
  });
}

export function workspaceHeaders(workspaceId: string): Record<string, string> {
  return { 'X-Workspace-Id': workspaceId };
}
