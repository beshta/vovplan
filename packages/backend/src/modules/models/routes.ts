import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { unlink } from 'node:fs/promises';
import prisma from '../../db/prisma.js';
import { getUserRole, requirePermission } from '../../utils/permissions.js';
import { emitModelChanged } from '../../realtime/index.js';
import { logActivity } from '../../utils/activity.js';

const UPLOADS_ROOT = join(process.cwd(), 'uploads');

/** Ensure upload directories exist */
function ensureDirs(projectId: string) {
  const projectDir = join(UPLOADS_ROOT, projectId);
  const lodsDir = join(projectDir, 'lods');
  if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });
  if (!existsSync(lodsDir)) mkdirSync(lodsDir, { recursive: true });
  return { projectDir, lodsDir };
}

export default async function modelRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /api/projects/:projectId/models ──
  // List all 3D models for a project
  fastify.get('/:projectId/models', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const role = await getUserRole(request.user.userId, projectId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Проект не найден', statusCode: 404 });
    }

    const models = await prisma.model3D.findMany({
      where: { projectId },
      include: {
        uploadedBy: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = models.map((m) => ({
      id: m.id,
      name: m.name,
      glbUrl: m.glbUrl,
      lod0Url: m.lod0Url ?? null,
      lod1Url: m.lod1Url ?? null,
      lod2Url: m.lod2Url ?? null,
      thumbnailUrl: m.thumbnailUrl ?? null,
      fileSize: m.fileSize,
      format: m.format,
      uploadedBy: m.uploadedBy.displayName,
      createdAt: m.createdAt.toISOString(),
    }));

    return reply.send({ data });
  });

  // ── POST /api/projects/:projectId/models ──
  // Upload a GLB file
  fastify.post('/:projectId/models', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    // Permission check — only designers and masters can upload
    await requirePermission(request, projectId, 'model:upload');

    /**
     * Разбор multipart.
     *
     * Файл сохраняется прямо здесь, внутри цикла, и это принципиально: перейти
     * к следующей части, не вычитав поток файла, нельзя — разбор встаёт, и
     * ответ не приходит вовсе. Раньше часть откладывали «на потом», и работало
     * это только пока файл целиком помещался во внутренний буфер: всё тяжелее
     * нескольких килобайт подвисало намертво, а на клиенте выглядело как
     * бесконечная загрузка.
     */
    ensureDirs(projectId);

    let name = '';
    let originalName = '';
    let filePath: string | null = null;
    let publicUrl = '';
    let safeExt: '.glb' | '.gltf' = '.glb';
    let wrongType = false;
    let truncated = false;

    for await (const part of request.parts()) {
      if (part.type !== 'file') {
        if (part.fieldname === 'name') name = (part.value as string) ?? '';
        continue;
      }

      const ext = extname(part.filename).toLowerCase();
      // Не наше поле, второй файл или неподходящий формат — поток всё равно
      // надо вычитать до конца, иначе разбор остановится на нём
      if (part.fieldname !== 'file' || filePath) {
        await part.toBuffer();
        continue;
      }
      if (ext !== '.glb' && ext !== '.gltf') {
        wrongType = true;
        await part.toBuffer();
        continue;
      }

      originalName = part.filename;
      safeExt = ext === '.gltf' ? '.gltf' : '.glb';
      const fileName = `${randomUUID()}${safeExt}`;
      filePath = join(UPLOADS_ROOT, projectId, fileName);
      publicUrl = `/uploads/${projectId}/${fileName}`;
      await pipeline(part.file, createWriteStream(filePath));
      // Файл больше разрешённого обрезается молча — на выходе был бы битый GLB
      truncated = part.file.truncated;
    }

    const fail = (code: number, message: string) => {
      if (filePath && existsSync(filePath)) unlinkSync(filePath);
      return reply.code(code).send({ error: 'VALIDATION_ERROR', message, statusCode: code });
    };

    if (truncated) {
      return fail(413, 'Файл слишком большой — не больше 100 МБ');
    }
    if (wrongType && !filePath) {
      return fail(400, 'Поддерживаются только .glb и .gltf');
    }
    if (!filePath) {
      return fail(400, 'Файл не предоставлен');
    }

    if (!name) name = originalName.replace(/\.(glb|gltf)$/i, '');

    // Get file size
    const fileSize = statSync(filePath).size;

    // Save to database
    const model = await prisma.model3D.create({
      data: {
        projectId,
        name,
        glbUrl: publicUrl,
        fileSize,
        format: safeExt.slice(1),
        uploadedById: request.user.userId,
        boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
      },
      include: {
        uploadedBy: { select: { id: true, displayName: true } },
      },
    });

    const payload = {
      id: model.id,
      name: model.name,
      glbUrl: model.glbUrl,
      lod0Url: model.lod0Url ?? null,
      lod1Url: model.lod1Url ?? null,
      lod2Url: model.lod2Url ?? null,
      thumbnailUrl: model.thumbnailUrl ?? null,
      fileSize: model.fileSize,
      format: model.format,
      uploadedBy: model.uploadedBy.displayName,
      createdAt: model.createdAt.toISOString(),
    };
    emitModelChanged(fastify, projectId, payload);
    logActivity(fastify, { projectId, actorId: request.user.userId, action: 'model.upload', targetName: model.name });
    return reply.code(201).send(payload);
  });

  // ── DELETE /api/projects/:projectId/models/:id ──
  fastify.delete('/:projectId/models/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };

    await requirePermission(request, projectId, 'model:upload');

    const existing = await prisma.model3D.findUnique({ where: { id } });
    if (!existing || existing.projectId !== projectId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Модель не найдена', statusCode: 404 });
    }

    // Delete file from disk
    const filePath = join(UPLOADS_ROOT, existing.glbUrl.replace(/^\/uploads\//, ''));
    try {
      await unlink(filePath);
    } catch {
      // File may already be gone — ignore
    }

    await prisma.model3D.delete({ where: { id } });
    emitModelChanged(fastify, projectId, { id, deleted: true });
    logActivity(fastify, { projectId, actorId: request.user.userId, action: 'model.delete', targetName: existing.name });
    return reply.code(204).send();
  });
}
