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
 * На фронте — ряд иконок под основной кнопкой формы. Пустой ключ в .env
 * не прячет иконку: человек видит, что сервис есть, и короткое «ещё не
 * подключён», а не пустую дыру в ряду.
 *
 * Telegram — Login Widget через редирект oauth.telegram.org (как иконка,
 * без iframe). HMAC проверяем так же, как у POST /telegram.
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
  /** OAuth state: латиница, без точки — VK ID иначе отклоняет запрос */
  s: string;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function oauthNonce(): string {
  return randomBytes(24).toString('base64url');
}

/** VK ID иногда кладёт code/state/device_id в JSON-параметр payload. */
function parseVkPayload(raw: string | undefined): { code?: string; state?: string; device_id?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; state?: unknown; device_id?: unknown };
    return {
      code: typeof parsed.code === 'string' ? parsed.code : undefined,
      state: typeof parsed.state === 'string' ? parsed.state : undefined,
      device_id: typeof parsed.device_id === 'string' ? parsed.device_id : undefined,
    };
  } catch {
    return {};
  }
}

function failRedirect(message: string, next = '/'): string {
  const q = new URLSearchParams({ error: message, next: safeNext(next) });
  return `${config.publicUrl}/login?${q.toString()}`;
}

function okRedirect(token: string, next: string): string {
  const q = new URLSearchParams({ accessToken: token, next });
  return `${config.publicUrl}/auth/oauth?${q.toString()}`;
}

const telegramQuerySchema = z.object({
  id: z.coerce.number(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.coerce.number(),
  hash: z.string(),
});

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
    const json = await formPost('https://id.vk.ru/oauth2/user_info', {
      client_id: creds('vk').id,
      access_token: accessToken,
    });
    const person =
      json.user && typeof json.user === 'object'
        ? (json.user as {
            user_id?: string | number;
            first_name?: string;
            last_name?: string;
            email?: string;
          })
        : {};
    const id = person.user_id != null ? String(person.user_id) : extra.user_id != null ? String(extra.user_id) : '';
    if (!id) throw new HttpError(502, 'OAUTH_PROVIDER', 'VK не вернул id');
    const email = str(person.email) || str(extra.email) || null;
    return {
      provider: enumId,
      providerUserId: id,
      email,
      emailVerified: Boolean(email),
      displayName: [person.first_name, person.last_name].filter(Boolean).join(' '),
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
    // VK ID, OAuth 2.1: не oauth.vk.com. Без PKCE и device_id кабинет ключи не примет.
    const u = new URL('https://id.vk.ru/authorize');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', id);
    u.searchParams.set('redirect_uri', redirect);
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('scope', 'vkid.personal_info email');
    u.searchParams.set('lang_id', '0');
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
  deviceId?: string,
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
    if (!deviceId) throw new HttpError(502, 'OAUTH_PROVIDER', 'VK не вернул device_id');
    const json = await formPost('https://id.vk.ru/oauth2/auth', {
      grant_type: 'authorization_code',
      client_id: id,
      service_token: secret,
      code,
      code_verifier: verifier,
      device_id: deviceId,
      redirect_uri: redirect,
    });
    if (json.error) throw new HttpError(502, 'OAUTH_PROVIDER', 'VK не выдал токен');
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
    const nonce = oauthNonce();
    const ticket: OauthTicket = { p: provider, v: verifier, n: next, t: Date.now(), s: nonce };
    setOauthCookie(reply, signBlob(ticket));
    return reply.redirect(authorizeUrl(provider, nonce, challenge));
  });

  // ── GET /api/auth/oauth/:provider/callback ─
  fastify.get('/oauth/:provider/callback', async (request, reply) => {
    rateLimit(request, 'oauth-cb', 30, 15 * 60_000);
    const provider = (request.params as { provider: string }).provider as OAuthId;
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
      device_id?: string;
      payload?: string;
    };
    const fromPayload = parseVkPayload(query.payload);
    const code = query.code || fromPayload.code;
    const deviceId = query.device_id || fromPayload.device_id;
    const stateRaw = query.state || fromPayload.state;
    const ticket = readBlob<OauthTicket>(readCookie(request));
    const next = ticket?.n || '/';
    clearOauthCookie(reply);

    if (query.error) {
      return reply.redirect(failRedirect('Вход через соцсеть отменён', next));
    }

    if (!ticket || ticket.p !== provider || !stateRaw || ticket.s !== stateRaw) {
      return reply.redirect(failRedirect('Сессия входа истекла. Попробуйте ещё раз', next));
    }
    if (Date.now() - ticket.t > COOKIE_MAX_AGE * 1000) {
      return reply.redirect(failRedirect('Сессия входа истекла. Попробуйте ещё раз', next));
    }
    if (!code) {
      return reply.redirect(failRedirect('Провайдер не вернул код', next));
    }

    try {
      const { accessToken, extra } = await exchangeCode(provider, code, ticket.v, deviceId);
      const profile = await profileFrom(provider, accessToken, extra);
      const user = await loginWithSocial(profile);
      const token = sessionOf(fastify, user);
      return reply.redirect(okRedirect(token, ticket.n || '/'));
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Не удалось войти через соцсеть';
      return reply.redirect(failRedirect(message, next));
    }
  });

  async function finishTelegram(
    payload: z.infer<typeof telegramQuerySchema>,
    next: string,
    reply: FastifyReply,
  ) {
    if (!verifyTelegramAuth(payload, config.oauth.telegram.token)) {
      return reply.redirect(failRedirect('Telegram не подтвердил вход', next));
    }
    const user = await loginWithSocial({
      provider: 'TELEGRAM',
      providerUserId: String(payload.id),
      email: null,
      emailVerified: false,
      displayName: telegramDisplayName(payload),
    });
    return reply.redirect(okRedirect(sessionOf(fastify, user), next));
  }

  // ── GET /api/auth/telegram/start ───────────
  // Иконка Telegram ведёт сюда — дальше oauth.telegram.org, как у OAuth.
  fastify.get('/telegram/start', async (request, reply) => {
    rateLimit(request, 'telegram-start', 30, 15 * 60_000);
    const next = safeNext((request.query as { next?: string }).next);
    if (!telegramEnabled()) {
      return reply.redirect(failRedirect('Вход через Telegram выключен', next));
    }
    const botId = config.oauth.telegram.token.split(':')[0];
    if (!/^\d+$/.test(botId)) {
      return reply.redirect(failRedirect('Telegram-бот настроен неверно', next));
    }
    setOauthCookie(reply, signBlob({ n: next, t: Date.now() }));
    const returnTo = `${config.publicUrl}/api/auth/telegram/callback`;
    const url = new URL('https://oauth.telegram.org/auth');
    url.searchParams.set('bot_id', botId);
    url.searchParams.set('origin', config.publicUrl);
    url.searchParams.set('request_access', 'write');
    url.searchParams.set('return_to', returnTo);
    return reply.redirect(url.toString());
  });

  // ── GET /api/auth/telegram/callback ────────
  fastify.get('/telegram/callback', async (request, reply) => {
    rateLimit(request, 'telegram-cb', 30, 15 * 60_000);
    const ticket = readBlob<{ n?: string; t?: number }>(readCookie(request));
    const next = ticket?.n || '/';
    clearOauthCookie(reply);
    if (!telegramEnabled()) {
      return reply.redirect(failRedirect('Вход через Telegram выключен', next));
    }
    const parsed = telegramQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.redirect(failRedirect('Telegram не вернул данные входа', next));
    }
    return finishTelegram(parsed.data, next, reply);
  });

  // ── POST /api/auth/telegram ────────────────
  // Старый путь: виджет POST-ит payload. Оставляем для совместимости.
  fastify.post('/telegram', async (request, reply) => {
    rateLimit(request, 'oauth-tg', 30, 15 * 60_000);
    if (!telegramEnabled()) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'Вход через Telegram выключен',
        statusCode: 404,
      });
    }

    const parsed = telegramQuerySchema.extend({ next: z.string().optional() }).safeParse(request.body);
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
