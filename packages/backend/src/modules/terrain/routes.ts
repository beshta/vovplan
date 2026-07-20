import type { FastifyInstance } from 'fastify';
import { join, basename } from 'node:path';
import { createWriteStream, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import prisma from '../../db/prisma.js';
import { requirePermission } from '../../utils/permissions.js';
import { emitTerrainChanged } from '../../realtime/index.js';
import { importRealTerrain } from './importer.js';
import { writeFileSync } from 'node:fs';

/**
 * Terrain upload routes — heightmap PNG for DEM-based terrain.
 *
 * POST   /api/projects/:projectId/terrain     — upload heightmap PNG
 * DELETE /api/projects/:projectId/terrain      — remove terrain
 */

const UPLOAD_DIR = join(process.cwd(), 'uploads');

// Allowed MIME types for heightmaps
const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export default async function terrainRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── Upload heightmap ──
  fastify.post('/:projectId/terrain', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    // Permission check: only DESIGNER+ can upload terrain
    await requirePermission(request, projectId, 'project:update');

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'Файл не загружен' });
    }

    // Validate MIME type
    if (!ALLOWED_TYPES.includes(data.mimetype)) {
      return reply.code(400).send({
        error: `Неподдерживаемый формат: ${data.mimetype}. Разрешены: PNG, JPEG`,
      });
    }

    // Create project uploads dir
    const projectDir = join(UPLOAD_DIR, projectId, 'terrain');
    mkdirSync(projectDir, { recursive: true });

    // Generate unique filename
    const ext = data.filename.split('.').pop() || 'png';
    const filename = `heightmap-${randomUUID()}.${ext}`;
    const filepath = join(projectDir, filename);

    // Save file (with size check)
    let totalSize = 0;
    const fileStream = createWriteStream(filepath);

    try {
      await pipeline(data.file, async function* (source) {
        for await (const chunk of source) {
          totalSize += chunk.length;
          if (totalSize > MAX_SIZE) {
            throw new Error(`Файл слишком большой (макс ${MAX_SIZE / 1024 / 1024}MB)`);
          }
          yield chunk;
        }
      }, fileStream);
    } catch (err) {
      if (existsSync(filepath)) unlinkSync(filepath);
      return reply.code(413).send({ error: (err as Error).message });
    }

    // Build public URL
    const terrainUrl = `/uploads/${projectId}/terrain/${filename}`;

    // Update project.terrainUrl (ручной heightmap — сбрасываем мету реального рельефа)
    const project = await prisma.project.update({
      where: { id: projectId },
      data: { terrainUrl, terrainMeta: null as any },
      select: { id: true, name: true, terrainUrl: true },
    });

    request.log.info({ projectId, terrainUrl }, 'Terrain heightmap uploaded');

    emitTerrainChanged(fastify, projectId, { terrainUrl, terrainMeta: null });

    return reply.code(200).send({
      id: project.id,
      name: project.name,
      terrainUrl,
    });
  });

  // ── Import real-world terrain by drawn polygon ──
  const importSchema = z.object({
    polygon: z
      .array(z.object({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) }))
      .min(3)
      .max(100),
  });

  fastify.post('/:projectId/terrain/import', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    await requirePermission(request, projectId, 'project:update');

    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректный полигон',
        statusCode: 400,
      });
    }

    // Ограничение площади: bbox не больше ~30км по стороне
    const lats = parsed.data.polygon.map((p) => p.lat);
    const lngs = parsed.data.polygon.map((p) => p.lng);
    const spanKm = Math.max(
      (Math.max(...lats) - Math.min(...lats)) * 111.32,
      (Math.max(...lngs) - Math.min(...lngs)) * 111.32 * Math.cos((lats[0] * Math.PI) / 180),
    );
    if (spanKm > 30) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: `Область слишком большая (${spanKm.toFixed(0)}км). Максимум — 30км по стороне.`,
        statusCode: 400,
      });
    }

    let result;
    try {
      result = await importRealTerrain(parsed.data.polygon);
    } catch (err) {
      request.log.error({ err }, 'Terrain import failed');
      return reply.code(502).send({
        error: 'UPSTREAM_ERROR',
        message:
          'Сервис данных рельефа сейчас недоступен (нет ответа от источника высот). ' +
          'Проверьте соединение и попробуйте через минуту.',
        detail: (err as Error).message,
        statusCode: 502,
      });
    }

    // Сохраняем файлы
    const projectDir = join(UPLOAD_DIR, projectId, 'terrain');
    mkdirSync(projectDir, { recursive: true });
    const id = randomUUID();
    const hmName = `real-${id}.png`;
    const texName = `tex-${id}.png`;
    const bldName = `buildings-${id}.json`;
    writeFileSync(join(projectDir, hmName), result.heightmap);
    writeFileSync(join(projectDir, texName), result.texture);
    writeFileSync(join(projectDir, bldName), JSON.stringify({ buildings: result.buildings }));

    const terrainUrl = `/uploads/${projectId}/terrain/${hmName}`;
    const terrainMeta = {
      textureUrl: `/uploads/${projectId}/terrain/${texName}`,
      buildingsUrl: `/uploads/${projectId}/terrain/${bldName}`,
      buildingCount: result.buildings.length,
      encoding: 'rg16', // 16-битные высоты: R — старший байт, G — младший
      widthM: Math.round(result.widthM),
      heightM: Math.round(result.heightM),
      minElev: Math.round(result.minElev * 10) / 10,
      maxElev: Math.round(result.maxElev * 10) / 10,
      polygon: result.polygonLocal.map(([x, z2]) => [Math.round(x * 10) / 10, Math.round(z2 * 10) / 10]),
      origin: { lat: result.origin.lat, lng: result.origin.lng },
    };

    await prisma.project.update({
      where: { id: projectId },
      data: { terrainUrl, terrainMeta },
    });

    request.log.info({ projectId, terrainUrl, spanKm }, 'Real terrain imported');

    emitTerrainChanged(fastify, projectId, { terrainUrl, terrainMeta });

    return reply.code(200).send({ terrainUrl, terrainMeta });
  });

  // ── Delete terrain ──
  fastify.delete('/:projectId/terrain', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    await requirePermission(request, projectId, 'project:update');

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { terrainUrl: true },
    });

    if (!project) {
      return reply.code(404).send({ error: 'Проект не найден' });
    }

    if (project.terrainUrl) {
      const filepath = join(UPLOAD_DIR, projectId, 'terrain', basename(project.terrainUrl));
      if (existsSync(filepath)) {
        unlinkSync(filepath);
      }

      await prisma.project.update({
        where: { id: projectId },
        data: { terrainUrl: null, terrainMeta: null as any },
      });

      emitTerrainChanged(fastify, projectId, { terrainUrl: null, terrainMeta: null });
    }

    return reply.code(204).send();
  });
}
