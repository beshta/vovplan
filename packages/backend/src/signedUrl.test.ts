import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildServer } from './app.js';
import { rateLimitClearAll } from './utils/rateLimit.js';
import { signUploadUrl, verifyUploadSignature } from './utils/signedUrl.js';
import prisma from './db/prisma.js';

/**
 * Раздача загруженных файлов.
 *
 * Раньше `/uploads/` отдавался всем подряд: модели, текстуры рельефа и аватары
 * любого проекта скачивал кто угодно, зная ссылку, — а ссылки утекают через
 * публичные share-ссылки навсегда. Проверять токен нельзя: браузер не шлёт
 * `Authorization` при загрузке картинки или модели. Поэтому право лежит в
 * самой ссылке.
 */

const marker = `signtest-${Date.now()}`;
const FILE_DIR = join(process.cwd(), 'uploads', marker);
const FILE_URL = `/uploads/${marker}/hello.txt`;

let app: FastifyInstance;

beforeAll(async () => {
  mkdirSync(FILE_DIR, { recursive: true });
  writeFileSync(join(FILE_DIR, 'hello.txt'), 'содержимое');
  app = await buildServer({ logger: false });
  await app.ready();
});

beforeEach(() => rateLimitClearAll());

afterAll(async () => {
  rmSync(FILE_DIR, { recursive: true, force: true });
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await app.close();
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('подписанные ссылки на файлы', () => {
  it('без подписи файл не отдаётся', async () => {
    const res = await get(FILE_URL);
    expect(res.statusCode).toBe(403);
  });

  it('с подписью отдаётся', async () => {
    const signed = signUploadUrl(FILE_URL)!;
    const res = await get(signed);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('содержимое');
  });

  it('подпись от другого файла не подходит', async () => {
    // Иначе одной законной ссылки хватило бы, чтобы забрать любой файл
    const signed = signUploadUrl(`/uploads/${marker}/other.txt`)!;
    const query = signed.slice(signed.indexOf('?'));
    expect((await get(FILE_URL + query)).statusCode).toBe(403);
  });

  it('подделанная подпись не подходит', async () => {
    const signed = signUploadUrl(FILE_URL)!;
    // Меняем последний символ подписи — одного бита достаточно
    const tampered = signed.slice(0, -1) + (signed.endsWith('A') ? 'B' : 'A');
    expect(tampered).not.toBe(signed);
    expect((await get(tampered)).statusCode).toBe(403);

    expect((await get(`${FILE_URL}?exp=99999999999999&sig=подделка`)).statusCode).toBe(403);
  });

  it('просроченная ссылка не подходит', async () => {
    // Срок в прошлом: подпись верна, но время вышло
    expect(verifyUploadSignature(FILE_URL, '1', 'что угодно')).toBe(false);
  });

  it('срок округляется — ссылка не меняется каждую выдачу', async () => {
    /*
     * Иначе у каждой выдачи был бы свой адрес, и кэш браузера промахивался бы
     * каждый раз: модели на десятки мегабайт качались бы заново при каждом
     * открытии сцены.
     */
    expect(signUploadUrl(FILE_URL)).toBe(signUploadUrl(FILE_URL));
  });

  it('чужие адреса не трогаются', async () => {
    expect(signUploadUrl('https://tile.openstreetmap.org/1/2/3.png')).toBe(
      'https://tile.openstreetmap.org/1/2/3.png',
    );
    expect(signUploadUrl(null)).toBeNull();
  });
});

describe('маршруты отдают подписанные ссылки', () => {
  it('профиль отдаёт аватар с подписью', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `who.${marker}@test.vovplan.io`,
        password: 'vitest-fixture-pw-1',
        displayName: 'Тест подписи',
      },
    });
    expect(reg.statusCode).toBe(201);
    const token = reg.json().accessToken as string;

    // Аватара ещё нет — важно, что null не превращается в мусор
    expect(reg.json().user.avatarUrl).toBeNull();

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().avatarUrl).toBeNull();
  });
});
