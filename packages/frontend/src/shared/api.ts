import type { User, AuthResponse, Project, ProjectMember, AccountLevel } from '@vovplan/shared';

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

// ── Пропуск в админку ─────────────────────────
/**
 * Хранится в sessionStorage, а не в localStorage, и это не мелочь.
 *
 * Пропуск живёт полчаса и означает право заблокировать кого угодно. В
 * localStorage он пережил бы и закрытие вкладки, и перезагрузку машины,
 * оставаясь лежать в браузере до истечения срока. sessionStorage умирает
 * вместе с вкладкой — ровно то поведение, которого ждёшь от «я зашёл в
 * админку на минуту».
 */
const ADMIN_PASS_KEY = 'vovplan_admin_pass';

interface AdminPass {
  token: string;
  /** Когда истекает, по часам браузера */
  until: number;
}

function readPass(): AdminPass | null {
  const raw = sessionStorage.getItem(ADMIN_PASS_KEY);
  if (!raw) return null;
  try {
    const pass = JSON.parse(raw) as AdminPass;
    // Просроченный убираем сразу: отправлять его на сервер — это гарантированный
    // отказ в ответ на действие, которое человек уже начал делать
    if (pass.until <= Date.now()) {
      sessionStorage.removeItem(ADMIN_PASS_KEY);
      return null;
    }
    return pass;
  } catch {
    sessionStorage.removeItem(ADMIN_PASS_KEY);
    return null;
  }
}

export const getAdminPass = (): string | null => readPass()?.token ?? null;
export const adminPassUntil = (): number | null => readPass()?.until ?? null;

export const setAdminPass = (token: string, ttlMs: number): void =>
  sessionStorage.setItem(ADMIN_PASS_KEY, JSON.stringify({ token, until: Date.now() + ttlMs }));

export const clearAdminPass = (): void => sessionStorage.removeItem(ADMIN_PASS_KEY);

// ── Ошибка ответа ─────────────────────────────
/**
 * Ошибка с кодом от сервера.
 *
 * Раньше наверх уходил голый `Error` с одним текстом, и различать случаи
 * приходилось поиском подстроки в сообщении — это ломается от любой правки
 * формулировки. Админке различать необходимо: `STEP_UP_REQUIRED` значит
 * «спроси код заново и повтори», а не «покажи красную плашку».
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Fetch wrapper ─────────────────────────────
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...options.headers as Record<string, string>,
  };

  // Content-Type только когда есть тело: fastify отклоняет DELETE/GET с
  // content-type=json и пустым телом (400 «Body cannot be empty»).
  // FormData — исключение: boundary проставляет браузер, свой заголовок ломает разбор.
  if (options.body != null && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Пропуск подкладывается сам и только для админских адресов: заставлять
  // каждый вызов админки помнить про заголовок — верный способ однажды забыть.
  if (path.startsWith('/api/admin')) {
    const pass = getAdminPass();
    if (pass) headers['X-Admin-Token'] = pass;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });
  } catch {
    throw new ApiError(
      'NETWORK',
      'Нет связи с сервером. Обновите страницу (Ctrl+Shift+R) и попробуйте снова.',
      0,
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Ошибка сети' }));
    throw new ApiError(body.error ?? 'ERROR', body.message ?? `Ошибка ${res.status}`, res.status);
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

  updateProfile: (data: { displayName?: string }) =>
    apiFetch<User>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),

  /*
   * Смена пароля обесценивает все прежние токены — в этом её смысл: пароль
   * меняют, когда подозревают чужой доступ. Взамен приходит токен нового
   * поколения для текущей вкладки, и его надо сохранить сразу, иначе
   * следующий же запрос получит 401 и человек выгонит сам себя.
   */
  changePassword: async (data: { currentPassword: string; newPassword: string }) => {
    const res = await apiFetch<{ ok: true; accessToken: string }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.accessToken) setToken(res.accessToken);
    return res;
  },

  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch<User>('/api/auth/avatar', { method: 'POST', body: form });
  },

  // ── Подтверждение адреса и восстановление пароля ──

  /** Подтвердить адрес по токену из письма. Вход при этом не нужен */
  verifyEmail: (token: string) =>
    apiFetch<{ ok: true }>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token }) }),

  /** Прислать письмо подтверждения заново */
  resendVerification: () =>
    apiFetch<{ ok: true; already?: boolean }>('/api/auth/verify/resend', { method: 'POST' }),

  /**
   * Запросить письмо для смены пароля.
   * Ответ одинаковый и для существующего адреса, и для несуществующего:
   * иначе форма превращается в проверялку, кто зарегистрирован в сервисе.
   */
  forgotPassword: (email: string) =>
    apiFetch<{ ok: true }>('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }),

  /** Задать новый пароль по токену из письма */
  resetPassword: (token: string, newPassword: string) =>
    apiFetch<{ ok: true }>('/api/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
};

// ── Analytics API ─────────────────────────────
export interface FunnelStep {
  name: string;
  label: string;
  count: number;
  /** доля от первого шага, % */
  ofTotal: number;
  /** доля от предыдущего шага, % — где именно теряются люди */
  ofPrev: number;
}

export const analyticsApi = {
  funnel: (days = 30) =>
    apiFetch<{ since: string; days: number; steps: FunnelStep[] }>(`/api/analytics/funnel?days=${days}`),
};

// ── Projects API ──────────────────────────────
export const projectsApi = {
  list: () => apiFetch<{ data: Project[] }>('/api/projects'),

  get: (id: string) => apiFetch<Project>(`/api/projects/${id}`),

  /** Сколько своих проектов занято и сколько всего можно. `limit: null` — без счёта */
  quota: () => apiFetch<{ used: number; limit: number | null }>('/api/projects/quota'),

  create: (data: {
    name: string;
    description?: string;
    centerLat: number;
    centerLng: number;
    bounds: { north: number; south: number; east: number; west: number };
  }) => apiFetch<Project>('/api/projects', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: string, data: Partial<{ name: string; description: string; status: string }>) =>
    apiFetch<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  /** Значок карточки */
  uploadIcon: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch<Project>(`/api/projects/${id}/icon`, { method: 'POST', body: form });
  },

  /** Превью карточки — снимок сцены из вьювера */
  uploadPreview: (id: string, blob: Blob) => {
    const form = new FormData();
    form.append('file', blob, 'preview.png');
    return apiFetch<Project>(`/api/projects/${id}/preview`, { method: 'POST', body: form });
  },

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
  locked?: boolean;
  groundSnap?: boolean;
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
    locked: boolean;
    groundSnap: boolean;
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

// ── Fences API (ограждение площадки) ──────────
export type FenceType = 'FAN_BARRIER' | 'MESH_3D' | 'CONCRETE';

export interface FencePayload {
  id: string;
  name: string;
  type: FenceType;
  geometry: [number, number, number][];
  /** null — типовая высота для этого типа */
  height: number | null;
  closed: boolean;
}

export const fencesApi = {
  list: (projectId: string) =>
    apiFetch<{ data: FencePayload[] }>(`/api/projects/${projectId}/fences`),

  create: (projectId: string, data: {
    name: string;
    type: FenceType;
    geometry: [number, number, number][];
    height?: number;
    closed?: boolean;
  }) =>
    apiFetch<FencePayload>(`/api/projects/${projectId}/fences`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (projectId: string, id: string, data: Partial<{
    name: string;
    type: FenceType;
    geometry: [number, number, number][];
    height: number;
    closed: boolean;
  }>) =>
    apiFetch<FencePayload>(`/api/projects/${projectId}/fences/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  remove: (projectId: string, id: string) =>
    apiFetch<void>(`/api/projects/${projectId}/fences/${id}`, { method: 'DELETE' }),
};

// ── Terrain API (DEM heightmap) ───────────────
/** Метаданные импортированного реального рельефа */
export interface TerrainMeta {
  /** Схема OSM (текстура по умолчанию) */
  textureUrl: string;
  /** Спутник Esri (переключается во вкладке «Ландшафт»); null если недоступен */
  satelliteUrl?: string | null;
  /** JSON со зданиями OSM: { buildings: [{ p, h, base }] } */
  buildingsUrl?: string;
  buildingCount?: number;
  /** JSON с природой OSM: { forests: [{ p, leaf }], water: [{ p, level }] } */
  natureUrl?: string;
  forestCount?: number;
  waterCount?: number;
  /** Кодирование heightmap: 'rg16' — 16 бит (R старший, G младший); нет — 8-бит яркость */
  encoding?: string;
  widthM: number;
  heightM: number;
  minElev: number;
  maxElev: number;
  /** Периметр в локальных метрах от центра области (x — восток, z — юг) */
  polygon: [number, number][];
  origin: { lat: number; lng: number };
  /**
   * Правка рельефа поверх исходных высот.
   *
   * Открытые данные о высотах идут сеткой 30 м: на участке в двести метров это
   * тринадцать точек поперёк, и мелкий рельеф там не столько измерен, сколько
   * додуман при растягивании. Настройка не трогает сам снимок высот и общая для
   * проекта, чтобы команда смотрела на одну и ту же местность.
   */
  adjust?: TerrainAdjust;
}

export interface TerrainAdjust {
  /** Радиус сглаживания, м: гасит ступеньки, которых в исходных данных нет */
  smooth: number;
  /** Подтягивание к опорной отметке: 0 — как есть, 1 — ровная площадка */
  level: number;
  /** Вертикальный масштаб; 1 — честные метры */
  scale: number;
}

/** Рельеф как есть, без правок */
export const TERRAIN_ADJUST_OFF: TerrainAdjust = { smooth: 0, level: 0, scale: 1 };

export const terrainApi = {
  /** Импорт реального рельефа по полигону с карты (lat/lng) */
  importReal: (projectId: string, polygon: { lat: number; lng: number }[]) =>
    apiFetch<{ terrainUrl: string; terrainMeta: TerrainMeta }>(
      `/api/projects/${projectId}/terrain/import`,
      { method: 'POST', body: JSON.stringify({ polygon }) },
    ),

  /** Сохранить правку рельефа — она общая для всех участников проекта */
  adjust: (projectId: string, adjust: TerrainAdjust) =>
    apiFetch<{ terrainMeta: TerrainMeta }>(
      `/api/projects/${projectId}/terrain/adjust`,
      { method: 'PATCH', body: JSON.stringify(adjust) },
    ),

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

// ── Activity API (лента изменений проекта) ────
export interface ActivityEventPayload {
  id: string;
  action: string;
  targetName: string | null;
  actorId: string;
  actorName: string;
  createdAt: string;
}

export const activityApi = {
  list: (projectId: string) =>
    apiFetch<{ data: ActivityEventPayload[] }>(`/api/projects/${projectId}/activity`),
};

// ── Scene Snapshots API (история версий) ──────
export interface SnapshotPayload {
  id: string;
  name: string;
  createdAt: string;
  authorName: string;
  counts: { objects: number; utilities: number; annotations: number };
}

export const snapshotsApi = {
  list: (projectId: string) =>
    apiFetch<{ data: SnapshotPayload[] }>(`/api/projects/${projectId}/snapshots`),
  create: (projectId: string, name: string) =>
    apiFetch<SnapshotPayload>(`/api/projects/${projectId}/snapshots`, { method: 'POST', body: JSON.stringify({ name }) }),
  restore: (projectId: string, id: string) =>
    apiFetch<{ restored: boolean; counts: any }>(`/api/projects/${projectId}/snapshots/${id}/restore`, { method: 'POST' }),
  remove: (projectId: string, id: string) =>
    apiFetch<void>(`/api/projects/${projectId}/snapshots/${id}`, { method: 'DELETE' }),
};

// ── Invites API (приглашение по ссылке) ───────
export interface InvitePayload {
  id: string;
  token: string;
  role: string;
  expiresAt: string | null;
  /** Сколько раз можно войти; null — без ограничения */
  maxUses: number | null;
  /** Сколько раз уже вошли */
  usedCount: number;
  createdAt: string;
}

export const invitesApi = {
  list: (projectId: string) =>
    apiFetch<{ data: InvitePayload[] }>(`/api/projects/${projectId}/invites`),
  create: (projectId: string, data: { role: string; expiresDays?: number; maxUses?: number }) =>
    apiFetch<InvitePayload>(`/api/projects/${projectId}/invites`, { method: 'POST', body: JSON.stringify(data) }),
  remove: (projectId: string, id: string) =>
    apiFetch<void>(`/api/projects/${projectId}/invites/${id}`, { method: 'DELETE' }),

  // Публичные (страница /invite/:token)
  info: (token: string) => apiFetch<{ projectName: string; role: string }>(`/api/invites/${token}`),
  accept: (token: string) => apiFetch<{ projectId: string; role: string; already: boolean }>(`/api/invites/${token}/accept`, { method: 'POST' }),
};

// ── Camera Presets API ────────────────────────
export interface CameraPresetPayload {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  sortOrder: number;
  createdAt: string;
}

export const presetsApi = {
  list: (projectId: string) =>
    apiFetch<{ data: CameraPresetPayload[] }>(`/api/projects/${projectId}/presets`),

  create: (projectId: string, data: { name: string; position: [number, number, number]; target: [number, number, number] }) =>
    apiFetch<CameraPresetPayload>(`/api/projects/${projectId}/presets`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  remove: (projectId: string, id: string) =>
    apiFetch<void>(`/api/projects/${projectId}/presets/${id}`, { method: 'DELETE' }),
};

// ── Share Links API ───────────────────────────
export interface ShareLinkPayload {
  id: string;
  token: string;
  name: string;
  presetId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export const sharesApi = {
  list: (projectId: string) =>
    apiFetch<{ data: ShareLinkPayload[] }>(`/api/projects/${projectId}/shares`),

  create: (projectId: string, data: { name: string; presetId?: string; expiresDays?: number }) =>
    apiFetch<ShareLinkPayload>(`/api/projects/${projectId}/shares`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  remove: (projectId: string, id: string) =>
    apiFetch<void>(`/api/projects/${projectId}/shares/${id}`, { method: 'DELETE' }),
};

// ── Public shared view (без авторизации) ──────
export interface SharedViewPayload {
  project: {
    name: string;
    description: string;
    terrainUrl: string | null;
    terrainMeta: TerrainMeta | null;
  };
  objects: {
    id: string;
    modelId: string;
    name: string;
    // Имени автора здесь нет намеренно: публичная ссылка не выдаёт состав
    // команды тому, кому её переслали
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    description: string;
  }[];
  models: { id: string; glbUrl: string; lod1Url: string | null; lod2Url: string | null }[];
  fences: FencePayload[];
  presets: { id: string; name: string; position: [number, number, number]; target: [number, number, number] }[];
  startPresetId: string | null;
}

export const sharedApi = {
  get: (token: string) => apiFetch<SharedViewPayload>(`/api/shared/${token}`),
};

/**
 * Открытые проекты: короткий адрес и витрина на главной.
 *
 * Отдают то же самое, что share-ссылка, — на сервере это буквально один
 * сборщик, — поэтому и тип общий. Разница только в том, чем открывается
 * дверь: там секретный токен, здесь решение хозяина сервиса.
 */
export const publicApi = {
  project: (id: string) => apiFetch<SharedViewPayload>(`/api/public/projects/${id}`),
  /** Витрина. `project: null` — ничего не выбрано, лендинг рисует свою сцену */
  featured: () =>
    apiFetch<(SharedViewPayload & { projectId: string }) | { project: null }>('/api/public/featured'),
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
  width: number | null;
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
    width?: number;
    parentId?: string;
  }) =>
    apiFetch<CommentPayload>(`/api/projects/${projectId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (projectId: string, id: string, data: Partial<{
    text: string;
    resolved: boolean;
    color: string;
    width: number;
  }>) =>
    apiFetch<CommentPayload>(`/api/projects/${projectId}/comments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  remove: (projectId: string, id: string) =>
    apiFetch<void>(`/api/projects/${projectId}/comments/${id}`, { method: 'DELETE' }),
};

// ── Админка ───────────────────────────────────
export interface AdminSummary {
  users: { total: number; week: number; month: number; banned: number; admins: number };
  projects: number;
  deletedProjects: number;
  publicProjects: number;
  terrainImports: number;
  /** Сумма размеров папок в uploads/ */
  storageBytes: number;
  /** Сколько людей на каждом уровне. Платных тарифов нет — это факт, не биллинг */
  levels: Record<AccountLevel, number>;
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  emailVerified: boolean;
  isAdmin: boolean;
  accountLevel: AccountLevel;
  bannedAt: string | null;
  banReason: string | null;
  /** В скольких проектах состоит */
  projects: number;
}

export interface AdminProjectRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isPublic: boolean;
  isFeatured: boolean;
  owner: { id: string; displayName: string; email: string } | null;
  members: number;
  objects: number;
  models: number;
  /** Сколько занимают загруженные файлы проекта */
  bytes: number;
}

export type AdminProjectFilter = 'all' | 'public' | 'featured' | 'deleted';

export interface AdminAuditRow {
  id: string;
  action: string;
  actorName: string;
  actorEmail: string;
  targetLabel: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AdminPage<T> {
  data: T[];
  page: number;
  total: number;
}

export const adminApi = {
  /** Вход: доступно с обычным токеном, пропуск не нужен — его тут и получают */
  status: () => apiFetch<{ totpEnabled: boolean; totpPending: boolean }>('/api/admin/auth/status'),
  totpSetup: () =>
    apiFetch<{ secret: string; uri: string; qr: string }>('/api/admin/auth/totp/setup', { method: 'POST' }),
  totpEnable: (code: string) =>
    apiFetch<{ backupCodes: string[] }>('/api/admin/auth/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  session: (code: string) =>
    apiFetch<{ adminToken: string; expiresIn: number }>('/api/admin/auth/session', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  // Всё ниже требует пропуска — он подставляется в apiFetch сам
  summary: () => apiFetch<AdminSummary>('/api/admin/summary'),
  users: (query: string, page: number) =>
    apiFetch<AdminPage<AdminUserRow>>(
      `/api/admin/users?page=${page}&query=${encodeURIComponent(query)}`,
    ),
  audit: (page: number) => apiFetch<AdminPage<AdminAuditRow>>(`/api/admin/audit?page=${page}`),

  ban: (id: string, reason: string) =>
    apiFetch<{ ok: true }>(`/api/admin/users/${id}/ban`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  unban: (id: string) => apiFetch<{ ok: true }>(`/api/admin/users/${id}/unban`, { method: 'POST' }),
  grant: (id: string) => apiFetch<{ ok: true }>(`/api/admin/users/${id}/admin`, { method: 'POST' }),
  revoke: (id: string) => apiFetch<{ ok: true }>(`/api/admin/users/${id}/admin`, { method: 'DELETE' }),
  setLevel: (id: string, level: AccountLevel) =>
    apiFetch<{ ok: true }>(`/api/admin/users/${id}/level`, {
      method: 'PATCH',
      body: JSON.stringify({ level }),
    }),

  projects: (query: string, filter: AdminProjectFilter, page: number) =>
    apiFetch<AdminPage<AdminProjectRow>>(
      `/api/admin/projects?page=${page}&filter=${filter}&query=${encodeURIComponent(query)}`,
    ),
  setPublic: (id: string, on: boolean) =>
    apiFetch<{ ok: true }>(`/api/admin/projects/${id}/public`, { method: on ? 'POST' : 'DELETE' }),
  setFeatured: (id: string, on: boolean) =>
    apiFetch<{ ok: true }>(`/api/admin/projects/${id}/feature`, { method: on ? 'POST' : 'DELETE' }),
  deleteProject: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/projects/${id}`, { method: 'DELETE' }),
  restoreProject: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/projects/${id}/restore`, { method: 'POST' }),
  purgeProject: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/projects/${id}/purge`, { method: 'DELETE' }),
  /** Снимок сцены без входа в комнату — участники хозяина не увидят */
  preview: (id: string) => apiFetch<SharedViewPayload>(`/api/admin/projects/${id}/preview`),
};
