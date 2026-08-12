import { useState } from 'react';
import { MailWarning, Check } from 'lucide-react';
import { authApi } from '../shared/api';
import { useAuthStore } from '../shared/authStore';

/**
 * Полоска «подтвердите адрес» для тех, кто этого ещё не сделал.
 *
 * Не блокирует работу намеренно: требовать подтверждения до первого входа —
 * значит терять людей на ровном месте, письмо задерживается или уходит в спам.
 * Полоска напоминает и даёт отправить письмо заново одной кнопкой.
 */
export default function VerifyEmailBanner() {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (!user || user.emailVerified) return null;

  const resend = async () => {
    setState('sending');
    try {
      await authApi.resendVerification();
      setState('sent');
    } catch (err) {
      setState('error');
      setMessage((err as Error).message);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25">
      <MailWarning size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
      <p className="text-sm text-amber-900 dark:text-amber-200 flex-1 min-w-0">
        Подтвердите адрес <span className="font-medium">{user.email}</span> — иначе вас не смогут
        пригласить в чужие проекты по почте.
      </p>

      {state === 'sent' ? (
        <span className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 shrink-0">
          <Check size={16} /> Письмо отправлено
        </span>
      ) : (
        <button
          onClick={resend}
          disabled={state === 'sending'}
          className="text-sm font-medium text-amber-700 dark:text-amber-300 hover:underline disabled:opacity-50 shrink-0"
        >
          {state === 'sending' ? 'Отправляем…' : 'Прислать письмо'}
        </button>
      )}

      {state === 'error' && (
        <span className="text-sm text-red-500 shrink-0">{message}</span>
      )}
    </div>
  );
}
