import { useState, useCallback, useEffect } from 'react';
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
  onFinished: () => void;
}

export default function AnnotationTool({ projectId, drawMode, onFinished }: AnnotationToolProps) {
  const [points, setPoints] = useState<[number, number, number][]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const addAnnotation = useViewerStore((s) => s.addAnnotation);
  const setGroundHandlers = useViewerStore((s) => s.setGroundHandlers);
  const color = useViewerStore((s) => s.annColor);
  const width = useViewerStore((s) => s.annWidth);
  const selectAnnotation = useViewerStore((s) => s.selectAnnotation);

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
        width,
      });

      addAnnotation({
        id: result.id,
        type: drawMode,
        points: pts,
        color,
        width,
        text: result.text,
        authorId: result.authorId,
        authorName: result.authorName,
        resolved: false,
        createdAt: result.createdAt,
      });
      // Сразу открываем редактор новой аннотации — задать текст/цвет/толщину
      selectAnnotation(result.id);
    } catch (err) {
      console.error('Failed to save annotation:', err);
    }

    setPoints([]);
    onFinished();
  }, [projectId, drawMode, color, width, addAnnotation, onFinished, selectAnnotation]);

  // ── Click handler (по точке рельефа от Scene) ──
  const handleClick = useCallback((pt: [number, number, number]) => {
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
  }, [drawMode, points, saveAnnotation]);

  // ── Pointer down/up for freehand ─────────────
  const handlePointerDown = useCallback((pt: [number, number, number]) => {
    if (drawMode !== 'freehand') return;
    setIsDragging(true);
    setPoints([pt]);
  }, [drawMode]);

  const handlePointerUp = useCallback(() => {
    if (drawMode !== 'freehand' || !isDragging) return;
    setIsDragging(false);
    if (points.length > 1) {
      saveAnnotation(points);
    }
  }, [drawMode, isDragging, points, saveAnnotation]);

  const handlePointerMove = useCallback((pt: [number, number, number]) => {
    if (drawMode !== 'freehand' || !isDragging) return;
    setPoints((prev) => [...prev, pt]);
  }, [drawMode, isDragging]);

  // ── Регистрация обработчиков кликов по рельефу ──
  useEffect(() => {
    setGroundHandlers({
      onClick: handleClick,
      onDown: handlePointerDown,
      onMove: handlePointerMove,
      onUp: handlePointerUp,
    });
    return () => setGroundHandlers(null);
  }, [setGroundHandlers, handleClick, handlePointerDown, handlePointerMove, handlePointerUp]);

  // ── Линия: Enter — завершить, Escape — отменить ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && drawMode === 'line' && points.length >= 2) {
        saveAnnotation(points);
      } else if (e.key === 'Escape') {
        setPoints([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, points, saveAnnotation]);

  // ── Render preview line ──────────────────────
  const previewGeom = points.length >= 2 ? (() => {
    const verts = points.map((p) => new THREE.Vector3(...p));
    return new THREE.BufferGeometry().setFromPoints(verts);
  })() : null;

  return (
    <group>
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
