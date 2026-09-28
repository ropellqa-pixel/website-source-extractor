import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Zap, Loader2 } from 'lucide-react';
import { getAdpodBySlug } from '../lib/pinAdpods';

interface AdpodPinLoginProps {
  /** Слаг адресного поддомена (АдПод) — пин-код должен быть привязан именно к нему. */
  adpodSlug: string;
}

/**
 * Страница адресного поддомена (АдПод) для быстрого входа.
 * Здесь доступен только вход по пин-коду: ввели 4 цифры → сразу открылся личный кабинет,
 * без ввода пароля. Работает только с пин-кодами, привязанными именно к этому адресу.
 */
export default function AdpodPinLogin({ adpodSlug }: AdpodPinLoginProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const { signInWithPin } = useAuth();
  const navigate = useNavigate();

  const adpod = getAdpodBySlug(adpodSlug);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      setError('Пин-код должен содержать 4 цифры');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await signInWithPin(pin, adpodSlug);
      setSuccess('Добро пожаловать! Переход...');
      await new Promise(resolve => setTimeout(resolve, 500));
      navigate('/dashboard');
    } catch (err: any) {
      console.error('Adpod pin sign-in error:', err);
      setError(err?.message || 'Неверный пин-код или он привязан к другому адресу');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl shadow-lg mb-4">
            <Zap className="w-10 h-10 text-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Вход по пин-коду</h1>
          <p className="text-muted-foreground">
            {adpod ? adpod.label : 'Введите пин-код для входа в АнодБИЗ'}
          </p>
        </div>

        <div className="bg-card backdrop-blur-sm rounded-[22px] shadow-[0_30px_60px_-30px_hsl(var(--logo-2)/0.25)] p-8 border border-border">
          <form onSubmit={handlePinSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-3">
                Пин-код
              </label>
              <div className="flex gap-3 justify-center">
                {[0, 1, 2, 3].map((i) => (
                  <input
                    key={i}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={pin[i] || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      const newPin = pin.split('');
                      newPin[i] = val;
                      const joined = newPin.join('').slice(0, 4);
                      setPin(joined);
                      if (val && i < 3) {
                        const inputs = (e.target as HTMLElement).parentElement?.querySelectorAll('input');
                        inputs?.[i + 1]?.focus();
                      }
                      setError('');
                      setSuccess('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !pin[i] && i > 0) {
                        const inputs = (e.target as HTMLElement).parentElement?.querySelectorAll('input');
                        inputs?.[i - 1]?.focus();
                      }
                    }}
                    className="w-16 h-20 bg-secondary border-2 border-border rounded-xl text-center text-3xl text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition-all"
                    autoFocus={i === 0}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-red-600 text-sm text-center">{error}</p>
              </div>
            )}

            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                <p className="text-emerald-600 text-sm text-center flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {success}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || pin.length !== 4}
              className="w-full bg-secondary text-foreground border border-border font-medium py-3.5 px-4 rounded-xl hover:bg-border focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Вход...
                </span>
              ) : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
