import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, MailCheck } from 'lucide-react';
import { authApi } from '../shared/api';

/**
 * Запрос письма для смены пароля.
 *
 * Ответ сервера одинаков и для существующего адреса, и для несуществующего,
 * поэтому и текст здесь один: «если такой адрес у нас есть — письмо ушло».
 * Написать «пользователь не найден» значило бы превратить форму в проверялку,
 * кто зарегистрирован в сервисе.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass max-w-md w-full text-center px-8 py-10">
          <MailCheck size={44} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
          <h1 className="text-xl font-semibold text-strong mb-2">Проверьте почту</h1>
          <p className="text-sm text-muted mb-6">
            Если адрес <span className="text-strong">{email}</span> зарегистрирован в VOVPLAN,
            письмо со ссылкой уже отправлено. Ссылка действует час.
          </p>
          <p className="text-xs text-muted mb-6">
            Письма нет? Загляните в спам — и проверьте, не опечатались ли в адресе.
          </p>
          <Link to="/login" className="btn-primary text-sm">Вернуться ко входу</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="glass max-w-md w-full px-8 py-10">
        <div className="text-center mb-6">
          <KeyRound size={40} className="mx-auto mb-3 text-vovplan-500" strokeWidth={1.5} />
          <h1 className="text-xl font-semibold text-strong mb-1.5">Забыли пароль?</h1>
          <p className="text-sm text-muted">
            Введите адрес, на который заведён аккаунт, — пришлём ссылку для смены пароля.
          </p>
        </div>

        <label className="input-label" htmlFor="forgot-email">Электронная почта</label>
        <input
          id="forgot-email"
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="input-field mb-4"
        />

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <button type="submit" disabled={busy || !email} className="btn-primary w-full text-sm mb-4">
          {busy ? 'Отправляем…' : 'Прислать ссылку'}
        </button>

        <p className="text-center text-xs text-muted">
          Вспомнили? <Link to="/login" className="text-vovplan-400 hover:underline">Войти</Link>
        </p>
      </form>
    </div>
  );
}
