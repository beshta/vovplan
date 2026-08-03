/**
 * Ошибка с HTTP-статусом.
 *
 * Именно Error, а не «голый» объект: Fastify рассчитывает на Error, а
 * глобальный обработчик в app.ts читает statusCode/code и сам формирует ответ.
 * Благодаря этому роутам не нужно оборачивать проверки прав в try/catch —
 * достаточно бросить, остальное сделает обработчик.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function httpError(statusCode: number, message: string, code = 'ERROR'): never {
  throw new HttpError(statusCode, code, message);
}

export const Errors = {
  NotFound: (message = 'Не найдено') => httpError(404, message, 'NOT_FOUND'),
  Forbidden: (message = 'Недостаточно прав') => httpError(403, message, 'FORBIDDEN'),
  Unauthorized: (message = 'Требуется авторизация') => httpError(401, message, 'UNAUTHORIZED'),
  BadRequest: (message = 'Некорректный запрос') => httpError(400, message, 'BAD_REQUEST'),
  Conflict: (message = 'Конфликт') => httpError(409, message, 'CONFLICT'),
};
