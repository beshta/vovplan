import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';

export default fp(async function corsPlugin(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/cors'), {
    origin: config.cors.origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
});
