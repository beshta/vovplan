// ═══════════════════════════════════════════════
// VOVPLAN — Shared Types
// ═══════════════════════════════════════════════

// ── Roles ──────────────────────────────────────
export enum ProjectRole {
  MASTER = 'MASTER',
  DESIGNER = 'DESIGNER',
  SUPER_SPECTATOR = 'SUPER_SPECTATOR',
  SPECTATOR = 'SPECTATOR',
  EXTERNAL_SPECTATOR = 'EXTERNAL_SPECTATOR',
}

export enum ProjectStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

// ── User ───────────────────────────────────────
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

// ── Project ────────────────────────────────────
export interface ProjectBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  bounds: ProjectBounds;
  centerLat: number;
  centerLng: number;
  terrainUrl: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  /** Role of the requesting user in this project */
  myRole?: ProjectRole;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  user: Pick<User, 'id' | 'displayName' | 'avatarUrl'>;
}

// ── Permissions ────────────────────────────────
export type Permission =
  | 'project:read'
  | 'project:update'
  | 'project:delete'
  | 'project:manage_members'
  | 'model:upload'
  | 'model:update'
  | 'model:delete'
  | 'utility:read'
  | 'comment:write';

// ── Utility Networks ───────────────────────────
export enum UtilityType {
  WATER = 'WATER',
  GAS = 'GAS',
  ELECTRIC = 'ELECTRIC',
  SEWAGE = 'SEWAGE',
  TELECOM = 'TELECOM',
  HEAT = 'HEAT',
}

export enum UtilityLocation {
  UNDERGROUND = 'UNDERGROUND',
  OVERHEAD = 'OVERHEAD',
}

export interface UtilityNetwork {
  id: string;
  projectId: string;
  name: string;
  type: UtilityType;
  location: UtilityLocation;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  depth: number | null;
  diameter: number | null;
  material: string | null;
  color: string;
}

// ── Scene Objects ──────────────────────────────
export interface SceneObject {
  id: string;
  projectId: string;
  modelId: string;
  /** Position in local scene coordinates (meters from project center) */
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  /** Metadata */
  name: string;
  authorId: string;
  visible: boolean;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ── Comments / Annotations ─────────────────────
export interface Comment {
  id: string;
  projectId: string;
  objectId: string | null;
  /** Optional 3D anchor point in scene coordinates */
  anchor: Vec3 | null;
  authorId: string;
  author: Pick<User, 'id' | 'displayName' | 'avatarUrl'>;
  text: string;
  resolved: boolean;
  parentId: string | null;
  createdAt: string;
}

// ── Models (3D assets) ─────────────────────────
export interface Model3D {
  id: string;
  projectId: string;
  name: string;
  /** S3 key for the processed GLB file */
  glbUrl: string;
  /** S3 keys for LOD variants */
  lod0Url: string | null;
  lod1Url: string | null;
  lod2Url: string | null;
  thumbnailUrl: string | null;
  /** Bounding box for LOD selection */
  boundingBox: BoundingBox;
  fileSize: number;
  format: 'glb' | 'gltf';
  uploadedById: string;
  createdAt: string;
}

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

// ── API helpers ────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
