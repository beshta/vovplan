import { useState, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useViewerStore } from '../stores/viewerStore';
import { commentsApi } from '../../../shared/api';

/**
 * Annotation drawing tool — captures 3D points via raycasting.
 *
 * Modes:
 * - 'pin': single click → create pin annotation
 * - 'arrow': 2 clicks (start + end) → create arrow
 * - 'line': multiple clicks → polyline, Enter to finish
 * - 'freehand': drag → continuous points, release to finish
 *
 * Only active when viewer mode is 'annotate' (SUPER_SPECTATOR).
 */

type DrawMode = 'pin' | 'arrow' | 'line' | 'freehand';

interface AnnotationToolProps {
  projectId: string;
  drawMode: DrawMode;
  color: string;
  onFinished: () => void;
}

export default function AnnotationTool({ projectId, drawMode, color, onFinished }: AnnotationToolProps) {
  const { raycaster, camera, pointer } = useThree();
  const [points, setPoints] = useState<[number, number, number][]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const addAnnotation = useViewerStore((s) => s.addAnnotation);

  // Get intersection point with terrain or objects
  const getHitPoint = useCallback((): [number, number, number] | null => {
    raycaster.setFromCamera(pointer, camera);
    const scene = camera.parent;
    if (!scene) return null;
    const intersects = raycaster.intersectObjects(scene.children, true);
    if (intersects.length === 0) return null;
    const pt = intersects[0].point;
    return [pt.x, pt.y, pt.z];
  }, [raycaster, camera, pointer]);

  const saveAnnotation = useCallback(async (pts: [number, number, number][]) => {
    if (pts.length === 0) return;

    const text = drawMode === 'pin'
      ? `Метка: ${new Date().toLocaleTimeString('ru-RU')}`
      : `Аннотация (${drawMode})`;

    try {
      const result = await commentsApi.create(projectId, {
        text,
        type: drawMode,
        geometry: pts,
        color,
      });

      addAnnotation({
        id: result.id,
        type: drawMode,
        points: pts,
        color,
        text: result.text,
        authorId: result.authorId,
        authorName: result.authorName,
        resolved: false,
        createdAt: result.createdAt,
      });
    } catch (err) {
      console.error('Failed to save annotation:', err);
    }

    setPoints([]);
    onFinished();
  }, [projectId, drawMode, color, addAnnotation, onFinished]);

  // ── Click handler ────────────────────────────
  const handleClick = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    const pt = getHitPoint();
    if (!pt) return;

    if (drawMode === 'pin') {
      saveAnnotation([pt]);
    } else if (drawMode === 'arrow') {
      const newPts = [...points, pt];
      setPoints(newPts);
      if (newPts.length >= 2) {
        saveAnnotation([newPts[0], newPts[1]]);
      }
    } else if (drawMode === 'line') {
      setPoints([...points, pt]);
    }
  }, [drawMode, points, getHitPoint, saveAnnotation]);

  // ── Pointer down/up for freehand ─────────────
  const handlePointerDown = useCallback((e: { stopPropagation: () => void }) => {
    if (drawMode !== 'freehand') return;
    e.stopPropagation();
    setIsDragging(true);
    const pt = getHitPoint();
    if (pt) setPoints([pt]);
  }, [drawMode, getHitPoint]);

  const handlePointerUp = useCallback(() => {
    if (drawMode !== 'freehand' || !isDragging) return;
    setIsDragging(false);
    if (points.length > 1) {
      saveAnnotation(points);
    }
  }, [drawMode, isDragging, points, saveAnnotation]);

  const handlePointerMove = useCallback(() => {
    if (drawMode !== 'freehand' || !isDragging) return;
    const pt = getHitPoint();
    if (pt) setPoints((prev) => [...prev, pt]);
  }, [drawMode, isDragging, getHitPoint]);

  // ── Render preview line ──────────────────────
  const previewGeom = points.length >= 2 ? (() => {
    const verts = points.map((p) => new THREE.Vector3(...p));
    return new THREE.BufferGeometry().setFromPoints(verts);
  })() : null;

  return (
    <group
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
    >
      {/* Preview line */}
      {previewGeom && (
        <line>
          <primitive object={previewGeom} attach="geometry" />
          <lineBasicMaterial color={color} transparent opacity={0.5} />
        </line>
      )}

      {/* Preview points */}
      {points.map((pt, i) => (
        <mesh key={i} position={pt}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}
