import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { unlink } from 'node:fs/promises';
import prisma from '../../db/prisma.js';
import { getUserRole, requirePermission } from '../../utils/permissions.js';

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
    try {
      await requirePermission(request, projectId, 'model:upload');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

    // Parse multipart
    const parts = request.parts();
    let file: any = null;
    let name = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        if (part.fieldname === 'file') {
          file = part;
        }
      } else {
        // text field
        if (part.fieldname === 'name') {
          name = (part.value as string) ?? '';
        }
      }
    }

    if (!file) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Файл не предоставлен', statusCode: 400 });
    }

    // Validate file type
    const ext = extname(file.filename).toLowerCase();
    if (ext !== '.glb' && ext !== '.gltf') {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Поддерживаются только .glb и .gltf', statusCode: 400 });
    }

    if (!name) name = file.filename.replace(/\.(glb|gltf)$/i, '');

    // Save file to disk
    ensureDirs(projectId);
    const fileId = randomUUID();
    const safeExt = ext === '.gltf' ? '.gltf' : '.glb';
    const fileName = `${fileId}${safeExt}`;
    const filePath = join(UPLOADS_ROOT, projectId, fileName);
    const publicUrl = `/uploads/${projectId}/${fileName}`;

    const saveStream = createWriteStream(filePath);
    await pipeline(file.file, saveStream);

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

    return reply.code(201).send({
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
    });
  });

  // ── DELETE /api/projects/:projectId/models/:id ──
  fastify.delete('/:projectId/models/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };

    try {
      await requirePermission(request, projectId, 'model:upload');
    } catch (err: any) {
      return reply.code(err.statusCode ?? 500).send(err);
    }

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
    return reply.code(204).send();
  });
}
