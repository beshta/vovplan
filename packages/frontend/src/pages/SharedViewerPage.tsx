import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sharedApi } from '../shared/api';
import PublicSceneView from '../features/viewer3d/components/PublicSceneView';

/**
 * Просмотр по share-ссылке — БЕЗ регистрации.
 * Роль External Spectator: только внешний вид сцены — без инженерных сетей,
 * комментариев, редактирования и realtime. Всё это обеспечивает общий вид,
 * здесь остаётся только запрос.
 */
export default function SharedViewerPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['shared', token],
    queryFn: () => sharedApi.get(token!),
    enabled: !!token,
    retry: false,
  });

  return <PublicSceneView data={data} isLoading={isLoading} error={error} badge="Публичный просмотр" />;
}
