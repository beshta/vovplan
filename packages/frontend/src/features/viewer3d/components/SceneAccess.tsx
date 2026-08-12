import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useViewerStore } from '../stores/viewerStore';

/**
 * Отдаёт саму сцену three наружу, за пределы Canvas.
 *
 * Кнопка выгрузки живёт в HUD — то есть вне дерева R3F, где до объектов сцены
 * не дотянуться. Тот же приём уже применяется для позы камеры и высоты
 * рельефа: изнутри Canvas регистрируется функция доступа, снаружи она
 * вызывается.
 *
 * Ничего не рисует.
 */
export default function SceneAccess() {
  const scene = useThree((s) => s.scene);
  const setSceneGetter = useViewerStore((s) => s.setSceneGetter);

  useEffect(() => {
    setSceneGetter(() => scene);
    // Сцена прошлого проекта наружу торчать не должна
    return () => setSceneGetter(null);
  }, [scene, setSceneGetter]);

  return null;
}
