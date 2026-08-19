import type { SharedViewPayload } from '../../shared/api';
import { usePublicScene } from '../../features/viewer3d/components/PublicSceneView';
import Scene from '../../features/viewer3d/components/Scene';

/**
 * Витрина в герое лендинга: настоящий проект вместо нарисованной кодом сцены.
 *
 * Ровно тот же вид, что видит посторонний по короткому адресу, — и та же
 * подготовка стора. Отличается только рамка вокруг: здесь нет ни шапки, ни
 * переключателя видов, чтобы витрина не притворялась рабочим окном.
 */
export default function FeaturedScene({ data }: { data: SharedViewPayload }) {
  // Перелёт не нужен: герой и так заполнен кадром, а стор общий с публичным
  // просмотром — иначе обзорный полёт дёргал бы витрину при каждом ответе API
  usePublicScene(data, false);
  // Канвас R3F заполняет родителя; без абсолютного растяжения он схлопнулся бы
  // до нуля внутри героя, у которого высота задана только минимумом
  return (
    <div className="absolute inset-0">
      <Scene currentUserId="" projectId="" shared />
    </div>
  );
}
