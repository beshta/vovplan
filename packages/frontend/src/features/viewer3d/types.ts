/**
 * VOVPLAN 3D Viewer — Internal Types
 */

/** Interaction modes — determines what the user can do in the scene */
export type ViewerMode = 'view' | 'master-edit' | 'partition-edit' | 'annotate';

/** Camera presets */
export type CameraView = 'orbit' | 'first-person';

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
  /** Bounding box in local coords */
  bbox?: { min: [number, number, number]; max: [number, number, number] };
}

/** A 3D annotation (arrow or line drawn by Super Spectator) */
export interface AnnotationData {
  id: string;
  type: 'arrow' | 'line' | 'freehand';
  points: [number, number, number][];
  color: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

/** Quality profile based on device capabilities */
export interface QualityProfile {
  maxAnisotropy: number;
  shadowMapSize: number;
  maxLod: 0 | 1 | 2;
  enableShadows: boolean;
  pixelRatio: number;
}
