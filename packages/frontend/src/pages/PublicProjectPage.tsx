import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../shared/api';
import PublicSceneView from '../features/viewer3d/components/PublicSceneView';

/**
 * Открытый проект по короткому адресу `/p/:id` — БЕЗ регистрации.
 *
 * Адрес угадываемый, в отличие от share-ссылки с её секретным токеном,
 * поэтому решает не знание адреса, а флаг публичности на сервере: закрытый
 * проект отвечает «не найдено» независимо от того, кто спрашивает.
 */
export default function PublicProjectPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-project', id],
    queryFn: () => publicApi.project(id!),
    enabled: !!id,
    retry: false,
  });

  return <PublicSceneView data={data} isLoading={isLoading} error={error} badge="Открытый проект" />;
}
