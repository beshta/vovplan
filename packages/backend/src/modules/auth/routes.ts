import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { registerSchema, loginSchema } from '@vovplan/shared';
import { ProjectRole } from '@prisma/client';
import prisma from '../../db/prisma.js';

export default async function authRoutes(fastify: FastifyInstance) {

  // ── POST /api/auth/register ───────────────
  fastify.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const { email, password, displayName } = parsed.data;

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({
        error: 'CONFLICT',
        message: 'Пользователь с таким email уже существует',
        statusCode: 409,
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: { email, passwordHash, displayName },
      select: { id: true, email: true, displayName: true, avatarUrl: true, createdAt: true },
    });

    // Generate JWT
    const accessToken = fastify.jwt.sign({ userId: user.id, email: user.email });

    return reply.code(201).send({ user, accessToken });
  });

  // ── POST /api/auth/login ──────────────────
  fastify.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные',
        statusCode: 400,
      });
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Неверный email или пароль',
        statusCode: 401,
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Неверный email или пароль',
        statusCode: 401,
      });
    }

    const accessToken = fastify.jwt.sign({ userId: user.id, email: user.email });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
      accessToken,
    });
  });

  // ── GET /api/auth/me ──────────────────────
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, email: true, displayName: true, avatarUrl: true, createdAt: true },
    });

    if (!user) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Пользователь не найден', statusCode: 404 });
    }

    return reply.send(user);
  });
}
