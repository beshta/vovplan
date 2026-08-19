import prisma from '../../db/prisma.js';
import { signUploadUrl, signTerrainMeta } from '../../utils/signedUrl.js';

/**
 * Сцена для постороннего наблюдателя — один сборщик на все публичные входы.
 *
 * Их теперь несколько: share-ссылка, проект, открытый всем, витрина и
 * тихий просмотр из админки. Собирать ответ в каждом отдельно — значит
 * однажды добавить поле в одном месте и забыть про второе. Забудут в ту
 * сторону, где показывается лишнее: сети, комментарии, скрытые объекты и
 * имена участников сюда не попадают намеренно. Заборы — часть внешнего
 * вида площадки, они здесь есть.
 */

export interface PublicScene {
  project: {
    name: string;
    description: string;
    terrainUrl: string | null;
    terrainMeta: unknown;
  };
  objects: {
    id: string;
    modelId: string;
    name: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    description: string;
  }[];
  models: { id: string; glbUrl: string; lod1Url: string | null; lod2Url: string | null }[];
  fences: {
    id: string;
    name: string;
    type: string;
    geometry: [number, number, number][];
    height: number | null;
    closed: boolean;
  }[];
  presets: {
    id: string;
    name: string;
    position: [number, number, number];
    target: [number, number, number];
  }[];
  startPresetId: string | null;
}

export async function buildPublicScene(
  projectId: string,
  startPresetId: string | null = null,
): Promise<PublicScene | null> {
  const [project, objects, models, fences, presets] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, description: true, terrainUrl: true, terrainMeta: true },
    }),
    prisma.sceneObject.findMany({
      where: { projectId, visible: true },
      // Автор не выбирается намеренно: состав команды — не то, что должен
      // узнать заказчик, получивший ссылку на сцену
      orderBy: { createdAt: 'asc' },
    }),
    prisma.model3D.findMany({
      where: { projectId },
      select: { id: true, glbUrl: true, lod1Url: true, lod2Url: true },
    }),
    prisma.fence.findMany({
      where: { projectId },
      select: { id: true, name: true, type: true, geometry: true, height: true, closed: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.cameraPreset.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  if (!project) return null;

  return {
    project: {
      name: project.name,
      description: project.description ?? '',
      terrainUrl: signUploadUrl(project.terrainUrl),
      terrainMeta: signTerrainMeta(project.terrainMeta),
    },
    objects: objects.map((o) => ({
      id: o.id,
      modelId: o.modelId ?? '',
      name: o.name,
      position: o.position as [number, number, number],
      rotation: o.rotation as [number, number, number],
      scale: o.scale as [number, number, number],
      description: o.description ?? '',
    })),
    models: models.map((m) => ({
      id: m.id,
      glbUrl: signUploadUrl(m.glbUrl)!,
      lod1Url: signUploadUrl(m.lod1Url),
      lod2Url: signUploadUrl(m.lod2Url),
    })),
    fences: fences.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      geometry: f.geometry as [number, number, number][],
      height: f.height,
      closed: f.closed,
    })),
    presets: presets.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position as [number, number, number],
      target: p.target as [number, number, number],
    })),
    startPresetId,
  };
}
