import type { FastifyInstance } from 'fastify';
import { join, basename } from 'node:path';
import { createWriteStream, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import prisma from '../../db/prisma.js';
import { requirePermission } from '../../utils/permissions.js';

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

    // Update project.terrainUrl
    const project = await prisma.project.update({
      where: { id: projectId },
      data: { terrainUrl },
      select: { id: true, name: true, terrainUrl: true },
    });

    request.log.info({ projectId, terrainUrl }, 'Terrain heightmap uploaded');

    return reply.code(200).send({
      id: project.id,
      name: project.name,
      terrainUrl,
    });
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
        data: { terrainUrl: null },
      });
    }

    return reply.code(204).send();
  });
}
