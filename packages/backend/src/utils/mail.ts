import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config/index.js';

/**
 * Отправка писем.
 *
 * Через SMTP, а не через API конкретного сервиса, намеренно: SMTP есть у всех
 * (Unisender, DashaMail, SendPulse, Яндекс 360, Mail.ru), и смена провайдера
 * сводится к правке переменных окружения, а не кода.
 *
 * Без настроенного SMTP письмо не теряется, а печатается в лог со ссылкой
 * внутри. Так вся механика подтверждения и восстановления работает и
 * проверяется локально, без единой внешней учётки. В продакшне о ненастроенной
 * почте сервер громко предупреждает при старте, но не падает: почта не нужна
 * для работы уже существующих проектов, и ронять из-за неё весь сервис —
 * несоразмерно.
 */

export interface Letter {
  to: string;
  subject: string;
  /** Простой текст. HTML намеренно не делаем: письма короткие, а текст
      доходит везде и не попадает в спам из-за вёрстки */
  text: string;
}

let transport: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!config.smtp.host) return null;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // 465 — TLS сразу, 587 и 25 — STARTTLS уже внутри соединения
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    // Без этого зависший SMTP (закрытый 465 на VPS, неверный пароль) держит
    // регистрацию минутами, nginx обрывает соединение, в браузере — Failed to fetch.
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
  });
  return transport;
}

/**
 * Отправляет письмо. Никогда не бросает наружу.
 *
 * Упавшая почта не должна ронять запрос, в котором она отправляется: человек
 * зарегистрировался — регистрация состоялась, даже если письмо не ушло. Иначе
 * сбой у почтового провайдера превращается в невозможность зарегистрироваться.
 * Отправить письмо заново можно отдельной кнопкой.
 */
export async function sendMail(log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }, letter: Letter): Promise<boolean> {
  const tx = getTransport();

  if (!tx) {
    // Не «молча ничего не сделали», а видимая запись с содержимым письма:
    // по ней в разработке проходят весь сценарий целиком
    log.info(
      { to: letter.to, subject: letter.subject, text: letter.text },
      'ПИСЬМО НЕ ОТПРАВЛЕНО (SMTP не настроен) — содержимое ниже',
    );
    return false;
  }

  try {
    await tx.sendMail({
      from: config.smtp.from,
      to: letter.to,
      subject: letter.subject,
      text: letter.text,
    });
    return true;
  } catch (err) {
    log.error({ err, to: letter.to, subject: letter.subject }, 'не удалось отправить письмо');
    return false;
  }
}

// ── Тексты писем ─────────────────────────────────────────────────────────────

/** Ссылка ведёт на фронтенд, а не на API: там страница, а не голый ответ */
const link = (path: string) => `${config.publicUrl}${path}`;

export function verifyEmailLetter(to: string, token: string): Letter {
  return {
    to,
    subject: 'VOVPLAN — подтвердите адрес почты',
    text: [
      'Здравствуйте!',
      '',
      'Подтвердите адрес почты, чтобы пользоваться VOVPLAN:',
      link(`/verify/${token}`),
      '',
      'Ссылка действует сутки.',
      '',
      'Если вы не регистрировались в VOVPLAN — просто не переходите по ссылке,',
      'аккаунт останется неподтверждённым и будет удалён.',
    ].join('\n'),
  };
}

export function resetPasswordLetter(to: string, token: string): Letter {
  return {
    to,
    subject: 'VOVPLAN — восстановление пароля',
    text: [
      'Здравствуйте!',
      '',
      'Вы запросили смену пароля в VOVPLAN. Задать новый:',
      link(`/reset/${token}`),
      '',
      'Ссылка действует час и сработает один раз.',
      '',
      'Если вы этого не просили — ничего делать не нужно, пароль останется',
      'прежним. Но если такие письма приходят вам регулярно, сообщите нам.',
    ].join('\n'),
  };
}
