/**
 * VOVPLAN 3D Viewer — Internal Types
 */

/** Interaction modes — determines what the user can do in the scene */
export type ViewerMode = 'view' | 'master-edit' | 'partition-edit' | 'annotate';

/** Camera presets */
export type CameraView = 'orbit' | 'first-person' | 'top';

/** Which transform gizmo is active */
export type TransformMode = 'translate' | 'rotate' | 'scale';

/** A placed 3D object in the scene */
export interface SceneObjectData {
  id: string;
  modelId: string;
  name: string;
  authorId: string;
  authorName: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
  /** Soft-delete: if true, only Master sees it (semi-transparent) */
  hidden: boolean;
  hiddenBy?: string;
  /** Free-text description by the person who placed it */
  description?: string;
  /** URL to external documentation/specs */
  docUrl?: string;
  /** ISO date string */
  createdAt?: string;
  /** Locked = cannot be transformed without unlocking */
  locked?: boolean;
  /** Bounding box in local coords */
  bbox?: { min: [number, number, number]; max: [number, number, number] };
}

/** A 3D annotation (arrow, line, freehand, or pin drawn by Super Spectator) */
export interface AnnotationData {
  id: string;
  type: 'arrow' | 'line' | 'freehand' | 'pin';
  points: [number, number, number][];
  color: string;
  width?: number;
  text: string;
  authorId: string;
  authorName: string;
  resolved: boolean;
  createdAt: string;
}

/** Utility network type (вода, газ, электричество, канализация, связь, теплo) */
export type UtilityType = 'WATER' | 'GAS' | 'ELECTRIC' | 'SEWAGE' | 'TELECOM' | 'HEAT';

/** Utility location: underground or overhead */
export type UtilityLocation = 'UNDERGROUND' | 'OVERHEAD';

/** Engineering utility network — a polyline in 3D space */
export interface UtilityNetworkData {
  id: string;
  name: string;
  type: UtilityType;
  location: UtilityLocation;
  /** Polyline points in local scene coords: [[x, y, z], ...] */
  geometry: [number, number, number][];
  /** Burial depth in meters (for underground) */
  depth: number | null;
  /** Pipe diameter in mm */
  diameter: number | null;
  material: string | null;
  color: string;
}

/** Quality profile based on device capabilities */
export interface QualityProfile {
  maxAnisotropy: number;
  shadowMapSize: number;
  maxLod: 0 | 1 | 2;
  enableShadows: boolean;
  pixelRatio: number;
}
