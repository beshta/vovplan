import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { authApi } from '../shared/api';

/**
 * Новый пароль по ссылке из письма.
 *
 * После смены сервер обесценивает все выданные токены — в том числе тот, что
 * мог остаться у постороннего. Поэтому здесь не «вошли автоматически», а
 * отправляем ко входу: заново ввести только что заданный пароль недорого, а
 * подразумевать, что за экраном тот же человек, у которого угнали доступ, —
 * ровно та ошибка, ради которой пароль и меняли.
 */
export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = repeat.length > 0 && password !== repeat;
  const canSubmit = password.length >= 8 && password === repeat && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass max-w-md w-full text-center px-8 py-10">
          <CheckCircle2 size={44} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
          <h1 className="text-xl font-semibold text-strong mb-2">Пароль изменён</h1>
          <p className="text-sm text-muted mb-6">
            Все прежние входы отключены — если в аккаунт заходил кто-то ещё, теперь он вышел.
          </p>
          <Link to="/login" className="btn-primary text-sm">Войти с новым паролем</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="glass max-w-md w-full px-8 py-10">
        <div className="text-center mb-6">
          <KeyRound size={40} className="mx-auto mb-3 text-vovplan-500" strokeWidth={1.5} />
          <h1 className="text-xl font-semibold text-strong mb-1.5">Новый пароль</h1>
          <p className="text-sm text-muted">Не короче восьми символов.</p>
        </div>

        <label className="input-label" htmlFor="new-pw">Новый пароль</label>
        <input
          id="new-pw"
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-field mb-1"
        />
        {tooShort && <p className="text-xs text-amber-400 mb-3">Ещё {8 - password.length} символов</p>}
        {!tooShort && <div className="mb-3" />}

        <label className="input-label" htmlFor="repeat-pw">Повторите</label>
        <input
          id="repeat-pw"
          type="password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          className="input-field mb-1"
        />
        {mismatch && <p className="text-xs text-red-400 mb-3">Пароли не совпадают</p>}
        {!mismatch && <div className="mb-3" />}

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <button type="submit" disabled={!canSubmit} className="btn-primary w-full text-sm mb-4">
          {busy ? 'Сохраняем…' : 'Сохранить пароль'}
        </button>

        <p className="text-center text-xs text-muted">
          Ссылка не работает?{' '}
          <Link to="/forgot" className="text-vovplan-400 hover:underline">Запросить новую</Link>
        </p>
      </form>
    </div>
  );
}
