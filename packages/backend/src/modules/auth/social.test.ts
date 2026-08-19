import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../app.js';
import { rateLimitClearAll } from '../../utils/rateLimit.js';
import prisma from '../../db/prisma.js';
import { loginWithSocial, OAUTH_EMAIL_DOMAIN, syntheticEmail } from './social.js';

const marker = `social-${Date.now()}`;
const emailOf = (who: string) => `${who}.${marker}@test.vovplan.io`;

let app: FastifyInstance;

beforeEach(() => rateLimitClearAll());

beforeAll(async () => {
  app = await buildServer({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await app.close();
});

describe('syntheticEmail', () => {
  it('кладёт id провайдера в зарезервированный домен', () => {
    expect(syntheticEmail('TELEGRAM', '12345')).toBe(`telegram.12345@${OAUTH_EMAIL_DOMAIN}`);
  });

  it('вычищает опасные символы из id', () => {
    expect(syntheticEmail('WECHAT', 'ab/cd@ef')).toBe(`wechat.abcdef@${OAUTH_EMAIL_DOMAIN}`);
  });
});

describe('loginWithSocial', () => {
  it('создаёт учётку без пароля', async () => {
    const user = await loginWithSocial({
      provider: 'YANDEX',
      providerUserId: `ya-${marker}`,
      email: emailOf('yandex'),
      emailVerified: true,
      displayName: 'Яндекс Юзер',
    });
    expect(user.email).toBe(emailOf('yandex'));
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerified).toBeTruthy();
    expect(user.displayName).toBe('Яндекс Юзер');

    const linked = await prisma.socialAccount.findUnique({
      where: {
        provider_providerUserId: { provider: 'YANDEX', providerUserId: `ya-${marker}` },
      },
    });
    expect(linked?.userId).toBe(user.id);
  });

  it('повторный вход тем же провайдером возвращает ту же учётку', async () => {
    const first = await loginWithSocial({
      provider: 'GOOGLE',
      providerUserId: `g-${marker}`,
      email: emailOf('google'),
      emailVerified: true,
      displayName: 'G',
    });
    const second = await loginWithSocial({
      provider: 'GOOGLE',
      providerUserId: `g-${marker}`,
      email: emailOf('google-other'),
      emailVerified: true,
      displayName: 'Other',
    });
    expect(second.id).toBe(first.id);
    expect(second.email).toBe(first.email);
  });

  it('привязывает соцсеть к уже существующему аккаунту с той же почтой', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: emailOf('link'), password: 'vitest-fixture-pw-1', displayName: 'Уже был' },
    });
    expect(registered.statusCode).toBe(201);
    const userId = registered.json().user.id as string;

    const linked = await loginWithSocial({
      provider: 'FACEBOOK',
      providerUserId: `fb-${marker}`,
      email: emailOf('link').toUpperCase(),
      emailVerified: true,
      displayName: 'FB',
    });
    expect(linked.id).toBe(userId);
    expect(linked.passwordHash).toBeTruthy();
  });

  it('без почты заводит синтетический адрес и сразу считает его подтверждённым', async () => {
    const user = await loginWithSocial({
      provider: 'TELEGRAM',
      providerUserId: `tg-${marker}`,
      email: null,
      emailVerified: false,
      displayName: 'Tg',
    });
    expect(user.email).toBe(syntheticEmail('TELEGRAM', `tg-${marker}`));
    expect(user.emailVerified).toBeTruthy();
    expect(user.passwordHash).toBeNull();
  });

  it('не использует @oauth.invalid как настоящую почту для склейки', async () => {
    const first = await loginWithSocial({
      provider: 'WECHAT',
      providerUserId: `wx-a-${marker}`,
      email: `spoof@${OAUTH_EMAIL_DOMAIN}`,
      emailVerified: true,
      displayName: 'Wx',
    });
    const second = await loginWithSocial({
      provider: 'WECHAT',
      providerUserId: `wx-b-${marker}`,
      email: `spoof@${OAUTH_EMAIL_DOMAIN}`,
      emailVerified: true,
      displayName: 'Wx2',
    });
    expect(first.id).not.toBe(second.id);
    expect(first.email).toBe(syntheticEmail('WECHAT', `wx-a-${marker}`));
    expect(second.email).toBe(syntheticEmail('WECHAT', `wx-b-${marker}`));
  });

  it('пустое имя заменяется на «Пользователь»', async () => {
    const user = await loginWithSocial({
      provider: 'VK',
      providerUserId: `vk-${marker}`,
      email: emailOf('vkname'),
      emailVerified: false,
      displayName: '  x  ',
    });
    expect(user.displayName).toBe('Пользователь');
  });

  it('заблокированному вход через соцсеть закрыт', async () => {
    const user = await loginWithSocial({
      provider: 'GOOGLE',
      providerUserId: `ban-${marker}`,
      email: emailOf('banned'),
      emailVerified: true,
      displayName: 'Ban',
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { bannedAt: new Date(), banReason: 'тест' },
    });
    await expect(
      loginWithSocial({
        provider: 'GOOGLE',
        providerUserId: `ban-${marker}`,
        email: emailOf('banned'),
        emailVerified: true,
        displayName: 'Ban',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_BANNED' });
  });
});

describe('oauth HTTP', () => {
  it('список провайдеров — только известные id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/oauth/providers' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { providers: string[]; telegram: { username: string } | null };
    expect(Array.isArray(body.providers)).toBe(true);
    for (const id of body.providers) {
      expect(['google', 'yandex', 'facebook', 'vk', 'wechat']).toContain(id);
    }
    if (body.telegram) expect(typeof body.telegram.username).toBe('string');
  });

  it('неизвестный провайдер уводит на страницу входа', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/oauth/twitter' });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain('/login?error=');
    expect(decodeURIComponent(location)).toContain('выключен');
  });

  it('Telegram без данных не проходит', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: {},
    });
    expect([400, 404]).toContain(res.statusCode);
  });

  it('учётка только из соцсети не входит по паролю', async () => {
    const user = await loginWithSocial({
      provider: 'YANDEX',
      providerUserId: `social-only-${marker}`,
      email: emailOf('socialonly'),
      emailVerified: true,
      displayName: 'Solo',
    });
    expect(user.passwordHash).toBeNull();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: emailOf('socialonly'), password: 'anything-long' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('SOCIAL_ONLY');
  });
});
