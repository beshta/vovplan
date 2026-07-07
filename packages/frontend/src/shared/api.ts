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

// ── Scene Objects API ─────────────────────────
export interface SceneObjectPayload {
  id: string;
  modelId: string;
  name: string;
  authorId: string;
  authorName: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
  hidden: boolean;
  description?: string;
  docUrl?: string;
  createdAt?: string;
}

export const sceneApi = {
  listObjects: (projectId: string) =>
    apiFetch<{ data: SceneObjectPayload[] }>(`/api/projects/${projectId}/objects`),

  createObject: (projectId: string, data: { name: string; modelId?: string; position: [number, number, number] }) =>
    apiFetch<SceneObjectPayload>(`/api/projects/${projectId}/objects`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateObject: (projectId: string, id: string, data: Partial<{
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    visible: boolean;
    description: string;
    docUrl: string;
  }>) =>
    apiFetch<SceneObjectPayload>(`/api/projects/${projectId}/objects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteObject: (projectId: string, id: string) =>
    apiFetch<{ id: string; hidden: boolean }>(`/api/projects/${projectId}/objects/${id}`, {
      method: 'DELETE',
    }),

  restoreObject: (projectId: string, id: string) =>
    apiFetch<{ id: string; restored: boolean }>(`/api/projects/${projectId}/objects/${id}/restore`, {
      method: 'POST',
    }),
};

// ── Models API ────────────────────────────────
export interface Model3DPayload {
  id: string;
  name: string;
  glbUrl: string;
  lod0Url: string | null;
  lod1Url: string | null;
  lod2Url: string | null;
  thumbnailUrl: string | null;
  fileSize: number;
  format: string;
  uploadedBy: string;
  createdAt: string;
}

export const modelsApi = {
  list: (projectId: string) =>
    apiFetch<{ data: Model3DPayload[] }>(`/api/projects/${projectId}/models`),

  upload: async (projectId: string, file: File, name: string): Promise<Model3DPayload> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    const res = await fetch(`${API_URL}/api/projects/${projectId}/models`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(err.message ?? 'Upload failed');
    }
    return res.json();
  },

  remove: (projectId: string, id: string) =>
    apiFetch<void>(`/api/projects/${projectId}/models/${id}`, { method: 'DELETE' }),
};

// ── Utilities API (инженерные сети) ───────────
export type UtilityType = 'WATER' | 'GAS' | 'ELECTRIC' | 'SEWAGE' | 'TELECOM' | 'HEAT';
export type UtilityLocation = 'UNDERGROUND' | 'OVERHEAD';

export interface UtilityNetworkPayload {
  id: string;
  name: string;
  type: UtilityType;
  location: UtilityLocation;
  geometry: [number, number, number][];
  depth: number | null;
  diameter: number | null;
  material: string | null;
  color: string;
}

export const utilitiesApi = {
  list: (projectId: string) =>
    apiFetch<{ data: UtilityNetworkPayload[] }>(`/api/projects/${projectId}/utilities`),

  create: (projectId: string, data: {
    name: string;
    type: UtilityType;
    location: UtilityLocation;
    geometry: [number, number, number][];
    depth?: number;
    diameter?: number;
    material?: string;
    color?: string;
  }) =>
    apiFetch<UtilityNetworkPayload>(`/api/projects/${projectId}/utilities`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (projectId: string, id: string, data: Partial<{
    name: string;
    type: UtilityType;
    location: UtilityLocation;
    geometry: [number, number, number][];
    depth: number;
    diameter: number;
    material: string;
    color: string;
  }>) =>
    apiFetch<UtilityNetworkPayload>(`/api/projects/${projectId}/utilities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  remove: (projectId: string, id: string) =>
    apiFetch<void>(`/api/projects/${projectId}/utilities/${id}`, { method: 'DELETE' }),
};

// ── Terrain API (DEM heightmap) ───────────────
export const terrainApi = {
  upload: async (projectId: string, file: File): Promise<{ terrainUrl: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_URL}/api/projects/${projectId}/terrain`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(err.message ?? 'Upload failed');
    }
    return res.json();
  },

  remove: (projectId: string) =>
    apiFetch<void>(`/api/projects/${projectId}/terrain`, { method: 'DELETE' }),
};

// ── Comments / Annotations API ────────────────
export type AnnotationType = 'arrow' | 'line' | 'freehand' | 'pin';

export interface CommentPayload {
  id: string;
  projectId: string;
  objectId: string | null;
  anchor: number[] | null;
  authorId: string;
  authorName: string;
  text: string;
  resolved: boolean;
  parentId: string | null;
  type: AnnotationType | null;
  geometry: [number, number, number][] | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export const commentsApi = {
  list: (projectId: string) =>
    apiFetch<{ data: CommentPayload[] }>(`/api/projects/${projectId}/comments`),

  create: (projectId: string, data: {
    text: string;
    objectId?: string;
    anchor?: number[];
    type?: AnnotationType;
    geometry?: [number, number, number][];
    color?: string;
    parentId?: string;
  }) =>
    apiFetch<CommentPayload>(`/api/projects/${projectId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (projectId: string, id: string, data: Partial<{
    text: string;
    resolved: boolean;
  }>) =>
    apiFetch<CommentPayload>(`/api/projects/${projectId}/comments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  remove: (projectId: string, id: string) =>
    apiFetch<void>(`/api/projects/${projectId}/comments/${id}`, { method: 'DELETE' }),
};
