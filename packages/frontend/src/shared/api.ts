import type { User, AuthResponse, Project, ProjectMember } from '@vovplan/shared';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'vovplan_token';

// ── Token management ──────────────────────────
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ── Fetch wrapper ─────────────────────────────
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Ошибка сети' }));
    throw new Error(body.message ?? `Ошибка ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Auth API ──────────────────────────────────
export const authApi = {
  register: (data: { email: string; password: string; displayName: string }) =>
    apiFetch<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    apiFetch<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  me: () => apiFetch<User>('/api/auth/me'),
};

// ── Projects API ──────────────────────────────
export const projectsApi = {
  list: () => apiFetch<{ data: Project[] }>('/api/projects'),

  get: (id: string) => apiFetch<Project>(`/api/projects/${id}`),

  create: (data: {
    name: string;
    description?: string;
    centerLat: number;
    centerLng: number;
    bounds: { north: number; south: number; east: number; west: number };
  }) => apiFetch<Project>('/api/projects', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: string, data: Partial<{ name: string; description: string }>) =>
    apiFetch<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  delete: (id: string) =>
    apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' }),

  // ── Members ─────────────────────────────────
  listMembers: (id: string) =>
    apiFetch<{ data: ProjectMember[] }>(`/api/projects/${id}/members`),

  inviteMember: (id: string, data: { email: string; role: string }) =>
    apiFetch<ProjectMember>(`/api/projects/${id}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateMemberRole: (id: string, userId: string, role: string) =>
    apiFetch<ProjectMember>(`/api/projects/${id}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  removeMember: (id: string, userId: string) =>
    apiFetch<void>(`/api/projects/${id}/members/${userId}`, { method: 'DELETE' }),
};
