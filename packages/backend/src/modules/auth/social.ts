import type { AuthProvider, User } from '@prisma/client';
import prisma from '../../db/prisma.js';
import { HttpError } from '../../utils/errors.js';
import { findUserByEmail, normalizeEmail } from '../../utils/email.js';

/**
 * Вход через соцсеть.
 *
 * Ищем сначала по паре «провайдер + их id» — это единственный устойчивый ключ:
 * у Telegram и WeChat почты нет, а у Facebook она часто не приходит. Почту
 * используем только чтобы не плодить вторую учётку человеку, который уже
 * регистрировался обычным способом.
 */

export interface SocialProfile {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
}

/** Зарезервированный домен: на него нельзя получить письмо, и SMTP туда не ходит */
export const OAUTH_EMAIL_DOMAIN = 'oauth.invalid';

export function syntheticEmail(provider: AuthProvider, providerUserId: string): string {
  const safe = providerUserId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80) || 'unknown';
  return `${provider.toLowerCase()}.${safe}@${OAUTH_EMAIL_DOMAIN}`;
}

function banned(reason: string | null): never {
  throw new HttpError(
    403,
    'ACCOUNT_BANNED',
    reason ? `Учётная запись заблокирована. Причина: ${reason}` : 'Учётная запись заблокирована',
  );
}

function displayNameOf(raw: string): string {
  const name = raw.trim().slice(0, 50);
  return name.length >= 2 ? name : 'Пользователь';
}

export async function loginWithSocial(profile: SocialProfile): Promise<User> {
  const linked = await prisma.socialAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    },
    include: { user: true },
  });
  if (linked) {
    if (linked.user.bannedAt) banned(linked.user.banReason);
    return linked.user;
  }

  const realEmail =
    profile.email && !profile.email.toLowerCase().endsWith(`@${OAUTH_EMAIL_DOMAIN}`)
      ? normalizeEmail(profile.email)
      : null;

  if (realEmail) {
    const existing = await findUserByEmail(realEmail);
    if (existing) {
      if (existing.bannedAt) banned(existing.banReason);
      await prisma.socialAccount.create({
        data: {
          userId: existing.id,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
      });
      if (profile.emailVerified && !existing.emailVerified) {
        return prisma.user.update({
          where: { id: existing.id },
          data: { emailVerified: new Date() },
        });
      }
      return existing;
    }
  }

  const email = realEmail ?? syntheticEmail(profile.provider, profile.providerUserId);
  // Синтетическую почту не просим подтверждать: письма туда не дойдут,
  // а полоска «подтвердите адрес» только злила бы. Настоящую — только если
  // провайдер сам её подтвердил (Google).
  const verifiedAt = realEmail ? (profile.emailVerified ? new Date() : null) : new Date();

  try {
    return await prisma.user.create({
      data: {
        email,
        displayName: displayNameOf(profile.displayName),
        passwordHash: null,
        emailVerified: verifiedAt,
        socialAccounts: {
          create: {
            provider: profile.provider,
            providerUserId: profile.providerUserId,
          },
        },
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'P2002') throw err;
    const again = await prisma.socialAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
      },
      include: { user: true },
    });
    if (again) {
      if (again.user.bannedAt) banned(again.user.banReason);
      return again.user;
    }
    throw err;
  }
}
