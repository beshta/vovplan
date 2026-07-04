/**
 * Throw an HTTP-friendly error.
 * In Fastify, any object with `statusCode` is handled by setErrorHandler.
 */
export function httpError(statusCode: number, message: string, code?: string): never {
  throw { statusCode, error: code ?? 'ERROR', message };
}

export const Errors = {
  NotFound: (message = 'Не найдено') => httpError(404, message, 'NOT_FOUND'),
  Forbidden: (message = 'Недостаточно прав') => httpError(403, message, 'FORBIDDEN'),
  Unauthorized: (message = 'Требуется авторизация') => httpError(401, message, 'UNAUTHORIZED'),
  BadRequest: (message = 'Некорректный запрос') => httpError(400, message, 'BAD_REQUEST'),
  Conflict: (message = 'Конфликт') => httpError(409, message, 'CONFLICT'),
};
