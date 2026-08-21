import { useState, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useViewerStore } from '../stores/viewerStore';
import { commentsApi } from '../../../shared/api';
import { useAuthStore } from '../../../shared/authStore';

/**
 * Annotation drawing tool — captures 3D points via raycasting.
 *
 * Точки ставятся ДВОЙНЫМ щелчком: одиночный занят вращением камеры.
 *
 * Modes:
 * - 'pin': двойной щелчок → метка
 * - 'arrow': два двойных щелчка (начало + конец) → стрелка
 * - 'line': ломаная, Enter — завершить
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
  const updateAnnotation = useViewerStore((s) => s.updateAnnotation);
  const removeAnnotation = useViewerStore((s) => s.removeAnnotation);
  const setGroundHandlers = useViewerStore((s) => s.setGroundHandlers);
  const color = useViewerStore((s) => s.annColor);
  const width = useViewerStore((s) => s.annWidth);
  const selectAnnotation = useViewerStore((s) => s.selectAnnotation);
  const setCameraLocked = useViewerStore((s) => s.setCameraLocked);
  const setAnnDrawMode = useViewerStore((s) => s.setAnnDrawMode);
  const authorId = useAuthStore((s) => s.user?.id ?? '');
  const authorName = useAuthStore((s) => s.user?.displayName ?? s.user?.email ?? 'Вы');

  /*
   * Метка появляется в сцене сразу, до ответа сервера.
   *
   * Раньше двойной щелчок уходил в POST и ждал его: на площадке это заметная
   * пауза между действием и результатом, и человек успевал щёлкнуть второй
   * раз. Теперь метка ставится немедленно с временным номером, а ответ
   * сервера лишь подменяет номер на настоящий. Не сохранилась — убираем и
   * говорим об этом, а не оставляем призрак, который исчезнет при обновлении.
   */
  const saveAnnotation = useCallback(async (pts: [number, number, number][]) => {
    if (pts.length === 0) return;

    const text = drawMode === 'pin'
      ? `Метка: ${new Date().toLocaleTimeString('ru-RU')}`
      : `Аннотация (${drawMode})`;
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    addAnnotation({
      id: tempId,
      type: drawMode,
      points: pts,
      color,
      width,
      text,
      authorId,
      authorName,
      resolved: false,
      createdAt: new Date().toISOString(),
    });
    // Сразу открываем редактор новой аннотации — задать текст/цвет/толщину
    selectAnnotation(tempId);
    setPoints([]);
    onFinished();

    try {
      const result = await commentsApi.create(projectId, {
        text,
        type: drawMode,
        geometry: pts,
        color,
        width,
      });
      updateAnnotation(tempId, {
        id: result.id,
        text: result.text,
        authorId: result.authorId,
        authorName: result.authorName,
        createdAt: result.createdAt,
      });
      // Выделение держалось за временный номер — переводим на настоящий,
      // иначе редактор откроется в пустоту
      if (useViewerStore.getState().selectedAnnotationId === tempId) {
        selectAnnotation(result.id);
      }
    } catch (err) {
      console.error('Failed to save annotation:', err);
      removeAnnotation(tempId);
      if (useViewerStore.getState().selectedAnnotationId === tempId) selectAnnotation(null);
    }
  }, [
    projectId, drawMode, color, width, authorId, authorName,
    addAnnotation, updateAnnotation, removeAnnotation, onFinished, selectAnnotation,
  ]);

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
      // От руки рисуют протяжкой, точки там не ставят — и подсказка про
      // двойной щелчок в этом режиме была бы враньём
      onPlace: drawMode === 'freehand' ? undefined : handleClick,
      onDown: handlePointerDown,
      onMove: handlePointerMove,
      onUp: handlePointerUp,
    });
    return () => setGroundHandlers(null);
  }, [setGroundHandlers, handleClick, handlePointerDown, handlePointerMove, handlePointerUp]);

  /*
   * От руки рисуют протяжкой — тем же движением, каким вращают камеру.
   * Пока режим включён, орбита выключена целиком, иначе каждый штрих
   * заодно разворачивает сцену. Разблокировка — в возврате эффекта, так что
   * камера освобождается и при смене инструмента, и при выходе из аннотаций.
   */
  useEffect(() => {
    if (drawMode !== 'freehand') return;
    setCameraLocked(true);
    return () => setCameraLocked(false);
  }, [drawMode, setCameraLocked]);

  // ── Линия: Enter — завершить, Escape — отменить ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && drawMode === 'line' && points.length >= 2) {
        saveAnnotation(points);
      } else if (e.key === 'Escape') {
        setPoints([]);
        // Из режима от руки Escape ещё и выпускает: он единственный держит
        // камеру, и застрять в нём без выхода с клавиатуры — ловушка
        if (drawMode === 'freehand') setAnnDrawMode('pin');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, points, saveAnnotation, setAnnDrawMode]);

  /*
   * Превью-линия.
   *
   * Геометрия собиралась прямо в теле компонента и не освобождалась никогда.
   * При рисовании от руки точка добавляется на каждое движение мыши, то есть
   * десятки раз в секунду, — и столько же буферов оставалось висеть в
   * видеопамяти. Отсюда были десятки тысяч геометрий в счётчиках нагрузки.
   * Теперь буфер один на набор точек, и предыдущий освобождается при смене.
   */
  const previewGeom = useMemo(
    () => (points.length >= 2
      ? new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)))
      : null),
    [points],
  );
  useEffect(() => () => previewGeom?.dispose(), [previewGeom]);

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
