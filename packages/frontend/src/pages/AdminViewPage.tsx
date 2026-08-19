import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminApi, getAdminPass } from '../shared/api';
import { useAuthStore } from '../shared/authStore';
import PublicSceneView from '../features/viewer3d/components/PublicSceneView';

/**
 * Тихий просмотр любого проекта из админки.
 *
 * Не вход под чужой учёткой и не join в комнату: тот же снимок сцены, что у
 * публичной ссылки. Участники никого не увидят — сокет здесь не открывается.
 * Пропуск живёт в sessionStorage этой вкладки, поэтому маршрут на том же
 * origin, без новой вкладки.
 */
export default function AdminViewPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const pass = getAdminPass();
  const allowed = !!user?.isAdmin && !!pass && !!id;

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'preview', id],
    queryFn: () => adminApi.preview(id!),
    enabled: allowed,
    retry: false,
  });

  if (!user?.isAdmin || !pass) return <Navigate to="/admin" replace />;

  return <PublicSceneView data={data} isLoading={isLoading} error={error} badge="Просмотр" />;
}
