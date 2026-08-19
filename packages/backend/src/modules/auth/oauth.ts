import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthProvider } from '@prisma/client';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { HttpError } from '../../utils/errors.js';
import { rateLimit } from '../../utils/rateLimit.js';
import { loginWithSocial, type SocialProfile } from './social.js';
import { telegramDisplayName, verifyTelegramAuth } from './telegram.js';

/**
 * Вход через соцсети.
 *
 * Кнопки на сайте рисуются только для провайдеров с ключами в .env: иначе
 * человек нажимает «Войти через Яндекс» и получает мёртвую страницу ошибки
 * Яндекса. Пустой ключ = провайдер выключен.
 *
 * Telegram — не OAuth: виджет на странице, проверка HMAC на сервере.
 * WeChat — то, чем в Китае входят почти все; без аккаунта Open Platform
 * кнопка просто не показывается.
 */

export type OAuthId = 'google' | 'yandex' | 'facebook' | 'vk' | 'wechat';

const COOKIE = 'vovplan_oauth';
const COOKIE_MAX_AGE = 600;

const PROVIDER_ENUM: Record<OAuthId, AuthProvider> = {
  google: 'GOOGLE',
  yandex: 'YANDEX',
  facebook: 'FACEBOOK',
  vk: 'VK',
  wechat: 'WECHAT',
};

function creds(id: OAuthId): { id: string; secret: string } {
  return config.oauth[id];
}

export function enabledOAuth(): OAuthId[] {
  return (Object.keys(PROVIDER_ENUM) as OAuthId[]).filter((id) => {
    const c = creds(id);
    return Boolean(c.id && c.secret);
  });
}

export function telegramEnabled(): boolean {
  return Boolean(config.oauth.telegram.token && config.oauth.telegram.username);
}

function callbackUrl(provider: OAuthId): string {
  return `${config.publicUrl}/api/auth/oauth/${provider}/callback`;
}

function safeNext(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  return raw.slice(0, 300);
}

function signBlob(data: unknown): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = createHmac('sha256', config.jwt.secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function readBlob<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expect = createHmac('sha256', config.jwt.secret).update(payload).digest('base64url');
  if (sig.length !== expect.length) return null;
  const left = Buffer.from(sig);
  const right = Buffer.from(expect);
  if (left.length !== right.length) return null;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  if (diff !== 0) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

function setOauthCookie(reply: FastifyReply, value: string): void {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`,
  );
}

function clearOauthCookie(reply: FastifyReply): void {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function readCookie(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return undefined;
}

interface OauthTicket {
  p: OAuthId;
  v: string;
  n: string;
  t: number;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function failRedirect(message: string, next = '/'): string {
  const q = new URLSearchParams({ error: message, next: safeNext(next) });
  return `${config.publicUrl}/login?${q.toString()}`;
}

function okRedirect(token: string, next: string): string {
  const q = new URLSearchParams({ accessToken: token, next });
  return `${config.publicUrl}/auth/oauth?${q.toString()}`;
}

async function formPost(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = Object.fromEntries(new URLSearchParams(text));
  }
  if (!res.ok) {
    const err = typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
    throw new HttpError(502, 'OAUTH_PROVIDER', `Провайдер отказал: ${err}`);
  }
  return json;
}

async function formGet(url: string, query: Record<string, string>): Promise<Record<string, unknown>> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  const res = await fetch(u);
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.errcode) {
    throw new HttpError(502, 'OAUTH_PROVIDER', 'Провайдер отказал в обмене кода');
  }
  return json;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function profileFrom(provider: OAuthId, accessToken: string, extra: Record<string, unknown>): Promise<SocialProfile> {
  const enumId = PROVIDER_ENUM[provider];

  if (provider === 'google') {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new HttpError(502, 'OAUTH_PROVIDER', 'Не удалось прочитать профиль Google');
    const u = (await res.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
    if (!u.sub) throw new HttpError(502, 'OAUTH_PROVIDER', 'Google не вернул id');
    return {
      provider: enumId,
      providerUserId: u.sub,
      email: u.email ?? null,
      emailVerified: u.email_verified === true,
      displayName: u.name ?? '',
    };
  }

  if (provider === 'yandex') {
    const res = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    if (!res.ok) throw new HttpError(502, 'OAUTH_PROVIDER', 'Не удалось прочитать профиль Яндекса');
    const u = (await res.json()) as {
      id?: string;
      default_email?: string;
      emails?: string[];
      display_name?: string;
      real_name?: string;
    };
    if (!u.id) throw new HttpError(502, 'OAUTH_PROVIDER', 'Яндекс не вернул id');
    const email = u.default_email || u.emails?.[0] || null;
    return {
      provider: enumId,
      providerUserId: String(u.id),
      email,
      emailVerified: Boolean(email),
      displayName: u.display_name || u.real_name || '',
    };
  }

  if (provider === 'facebook') {
    const u = new URL('https://graph.facebook.com/me');
    u.searchParams.set('fields', 'id,name,email');
    u.searchParams.set('access_token', accessToken);
    const res = await fetch(u);
    if (!res.ok) throw new HttpError(502, 'OAUTH_PROVIDER', 'Не удалось прочитать профиль Facebook');
    const body = (await res.json()) as { id?: string; name?: string; email?: string };
    if (!body.id) throw new HttpError(502, 'OAUTH_PROVIDER', 'Facebook не вернул id');
    return {
      provider: enumId,
      providerUserId: body.id,
      email: body.email ?? null,
      emailVerified: Boolean(body.email),
      displayName: body.name ?? '',
    };
  }

  if (provider === 'vk') {
    const userId = extra.user_id != null ? String(extra.user_id) : '';
    const email = str(extra.email) || null;
    const u = new URL('https://api.vk.com/method/users.get');
    u.searchParams.set('access_token', accessToken);
    u.searchParams.set('v', '5.199');
    u.searchParams.set('fields', 'photo_200');
    const res = await fetch(u);
    const body = (await res.json()) as {
      response?: { id: number; first_name?: string; last_name?: string }[];
    };
    const person = body.response?.[0];
    const id = person ? String(person.id) : userId;
    if (!id) throw new HttpError(502, 'OAUTH_PROVIDER', 'VK не вернул id');
    return {
      provider: enumId,
      providerUserId: id,
      email,
      emailVerified: Boolean(email),
      displayName: [person?.first_name, person?.last_name].filter(Boolean).join(' '),
    };
  }

  // wechat
  const openid = str(extra.openid);
  if (!openid) throw new HttpError(502, 'OAUTH_PROVIDER', 'WeChat не вернул openid');
  const u = new URL('https://api.weixin.qq.com/sns/userinfo');
  u.searchParams.set('access_token', accessToken);
  u.searchParams.set('openid', openid);
  u.searchParams.set('lang', 'zh_CN');
  const res = await fetch(u);
  const body = (await res.json()) as { openid?: string; nickname?: string; errcode?: number };
  if (body.errcode) throw new HttpError(502, 'OAUTH_PROVIDER', 'Не удалось прочитать профиль WeChat');
  return {
    provider: enumId,
    providerUserId: body.openid || openid,
    email: null,
    emailVerified: false,
    displayName: body.nickname ?? '',
  };
}

function authorizeUrl(provider: OAuthId, state: string, challenge: string): string {
  const { id } = creds(provider);
  const redirect = callbackUrl(provider);

  if (provider === 'google') {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', id);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('prompt', 'select_account');
    return u.toString();
  }

  if (provider === 'yandex') {
    const u = new URL('https://oauth.yandex.ru/authorize');
    u.searchParams.set('client_id', id);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    u.searchParams.set('force_confirm', 'yes');
    return u.toString();
  }

  if (provider === 'facebook') {
    const u = new URL('https://www.facebook.com/v21.0/dialog/oauth');
    u.searchParams.set('client_id', id);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'email,public_profile');
    u.searchParams.set('state', state);
    return u.toString();
  }

  if (provider === 'vk') {
    const u = new URL('https://oauth.vk.com/authorize');
    u.searchParams.set('client_id', id);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'email');
    u.searchParams.set('state', state);
    u.searchParams.set('display', 'page');
    u.searchParams.set('v', '5.199');
    return u.toString();
  }

  const u = new URL('https://open.weixin.qq.com/connect/qrconnect');
  u.searchParams.set('appid', id);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'snsapi_login');
  u.searchParams.set('state', state);
  return `${u.toString()}#wechat_redirect`;
}

async function exchangeCode(
  provider: OAuthId,
  code: string,
  verifier: string,
): Promise<{ accessToken: string; extra: Record<string, unknown> }> {
  const { id, secret } = creds(provider);
  const redirect = callbackUrl(provider);

  if (provider === 'google') {
    const json = await formPost('https://oauth2.googleapis.com/token', {
      client_id: id,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirect,
      code_verifier: verifier,
    });
    const accessToken = str(json.access_token);
    if (!accessToken) throw new HttpError(502, 'OAUTH_PROVIDER', 'Google не выдал токен');
    return { accessToken, extra: json };
  }

  if (provider === 'yandex') {
    const json = await formPost('https://oauth.yandex.ru/token', {
      client_id: id,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
    });
    const accessToken = str(json.access_token);
    if (!accessToken) throw new HttpError(502, 'OAUTH_PROVIDER', 'Яндекс не выдал токен');
    return { accessToken, extra: json };
  }

  if (provider === 'facebook') {
    const u = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
    u.searchParams.set('client_id', id);
    u.searchParams.set('client_secret', secret);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('code', code);
    const res = await fetch(u);
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new HttpError(502, 'OAUTH_PROVIDER', 'Facebook не выдал токен');
    const accessToken = str(json.access_token);
    if (!accessToken) throw new HttpError(502, 'OAUTH_PROVIDER', 'Facebook не выдал токен');
    return { accessToken, extra: json };
  }

  if (provider === 'vk') {
    const u = new URL('https://oauth.vk.com/access_token');
    u.searchParams.set('client_id', id);
    u.searchParams.set('client_secret', secret);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('code', code);
    const res = await fetch(u);
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok || json.error) throw new HttpError(502, 'OAUTH_PROVIDER', 'VK не выдал токен');
    const accessToken = str(json.access_token);
    if (!accessToken) throw new HttpError(502, 'OAUTH_PROVIDER', 'VK не выдал токен');
    return { accessToken, extra: json };
  }

  const json = await formGet('https://api.weixin.qq.com/sns/oauth2/access_token', {
    appid: id,
    secret,
    code,
    grant_type: 'authorization_code',
  });
  const accessToken = str(json.access_token);
  if (!accessToken) throw new HttpError(502, 'OAUTH_PROVIDER', 'WeChat не выдал токен');
  return { accessToken, extra: json };
}

function sessionOf(
  fastify: FastifyInstance,
  user: { id: string; email: string; tokenVersion: number },
): string {
  return fastify.jwt.sign({
    userId: user.id,
    email: user.email,
    ver: user.tokenVersion,
  });
}

export default async function oauthRoutes(fastify: FastifyInstance) {
  // ── GET /api/auth/oauth/providers ──────────
  fastify.get('/oauth/providers', async () => ({
    providers: enabledOAuth(),
    telegram: telegramEnabled() ? { username: config.oauth.telegram.username } : null,
  }));

  // ── GET /api/auth/oauth/:provider ──────────
  fastify.get('/oauth/:provider', async (request, reply) => {
    rateLimit(request, 'oauth-start', 30, 15 * 60_000);
    const provider = (request.params as { provider: string }).provider as OAuthId;
    const next = safeNext((request.query as { next?: string }).next);
    if (!PROVIDER_ENUM[provider] || !creds(provider).id || !creds(provider).secret) {
      return reply.redirect(failRedirect('Этот вход сейчас выключен', next));
    }
    const { verifier, challenge } = pkce();
    const ticket: OauthTicket = { p: provider, v: verifier, n: next, t: Date.now() };
    const state = signBlob({ p: provider, t: ticket.t, n: next });
    setOauthCookie(reply, signBlob(ticket));
    return reply.redirect(authorizeUrl(provider, state, challenge));
  });

  // ── GET /api/auth/oauth/:provider/callback ─
  fastify.get('/oauth/:provider/callback', async (request, reply) => {
    rateLimit(request, 'oauth-cb', 30, 15 * 60_000);
    const provider = (request.params as { provider: string }).provider as OAuthId;
    const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    const ticket = readBlob<OauthTicket>(readCookie(request));
    const state = readBlob<{ p: OAuthId; t: number; n: string }>(query.state);
    const next = ticket?.n || state?.n || '/';
    clearOauthCookie(reply);

    if (query.error) {
      return reply.redirect(failRedirect('Вход через соцсеть отменён', next));
    }

    if (!ticket || !state || ticket.p !== provider || state.p !== provider) {
      return reply.redirect(failRedirect('Сессия входа истекла. Попробуйте ещё раз', next));
    }
    if (Date.now() - ticket.t > COOKIE_MAX_AGE * 1000) {
      return reply.redirect(failRedirect('Сессия входа истекла. Попробуйте ещё раз', next));
    }
    if (!query.code) {
      return reply.redirect(failRedirect('Провайдер не вернул код', next));
    }

    try {
      const { accessToken, extra } = await exchangeCode(provider, query.code, ticket.v);
      const profile = await profileFrom(provider, accessToken, extra);
      const user = await loginWithSocial(profile);
      const token = sessionOf(fastify, user);
      return reply.redirect(okRedirect(token, ticket.n || state.n || '/'));
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Не удалось войти через соцсеть';
      return reply.redirect(failRedirect(message, next));
    }
  });

  // ── POST /api/auth/telegram ────────────────
  fastify.post('/telegram', async (request, reply) => {
    rateLimit(request, 'oauth-tg', 30, 15 * 60_000);
    if (!telegramEnabled()) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'Вход через Telegram выключен',
        statusCode: 404,
      });
    }

    const parsed = z
      .object({
        id: z.coerce.number(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        username: z.string().optional(),
        photo_url: z.string().optional(),
        auth_date: z.coerce.number(),
        hash: z.string(),
        next: z.string().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Некорректные данные Telegram',
        statusCode: 400,
      });
    }

    const { next: nextRaw, ...payload } = parsed.data;
    if (!verifyTelegramAuth(payload, config.oauth.telegram.token)) {
      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Подпись Telegram не принята',
        statusCode: 401,
      });
    }

    const user = await loginWithSocial({
      provider: 'TELEGRAM',
      providerUserId: String(payload.id),
      email: null,
      emailVerified: false,
      displayName: telegramDisplayName(payload),
    });
    const accessToken = sessionOf(fastify, user);
    return reply.send({
      accessToken,
      next: safeNext(nextRaw),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
        isAdmin: user.isAdmin,
        accountLevel: user.accountLevel,
      },
    });
  });
}
