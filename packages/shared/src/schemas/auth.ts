import { z } from 'zod';

/*
 * Пробелы по краям срезаются до проверки формата: адрес часто вставляют из
 * буфера вместе с ними, и «Некорректный email» на вид правильном адресе
 * выглядит как поломка сервиса. Регистр приводится не здесь, а в одном месте
 * на сервере (utils/email) — там же, где ищут по адресу.
 */
export const registerSchema = z.object({
  email: z.string().trim().email('Некорректный email'),
  password: z.string().min(8, 'Пароль должен быть не менее 8 символов'),
  displayName: z.string().min(2, 'Имя должно быть не менее 2 символов').max(50),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Некорректный email'),
  password: z.string().min(1, 'Введите пароль'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
