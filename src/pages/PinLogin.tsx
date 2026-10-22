import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '@/lib/sdk';
import { ArrowLeft, Zap, Loader2, AlertCircle } from 'lucide-react';

export default function PinLogin() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

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
      const result = await auth.pinLookup(pin);

      if (!result) {
        setError('Неверный пин-код');
        setLoading(false);
        return;
      }

      const { email, full_name: userName } = result;

      localStorage.setItem('biz_pin_match', JSON.stringify({
        userName: userName || 'Сотрудник',
        profileEmail: email,
      }));

      setSuccess(`Найден: ${userName || 'Сотрудник'}. Переход...`);
      await new Promise(resolve => setTimeout(resolve, 500));

      navigate('/pin-auth');

    } catch (err: any) {
      console.error('Pin login error:', err);
      setError('Произошла ошибка. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-bg flex min-h-[100dvh] items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-[420px] reveal-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-5 rounded-[22px] bg-gradient-to-br from-[hsl(var(--logo-1))] to-[hsl(var(--logo-2))] shadow-[0_18px_30px_-8px_hsl(222_47%_11%/0.45)]">
            <Zap className="h-9 w-9 text-[hsl(var(--logo-bar))]" />
          </div>
          <h1 className="mb-1.5 font-head text-[28px] font-bold tracking-[-0.04em] text-foreground">Быстрый вход</h1>
          <p className="text-muted-foreground">Введите пин-код для входа в АнодБИЗ</p>
        </div>

        <div className="rounded-3xl border border-white/70 bg-card/90 p-6 shadow-pop backdrop-blur-xl sm:p-8">
          <form onSubmit={handlePinSubmit} className="space-y-5">
            <div>
              <label className="mb-4 block text-center text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Пин-код
              </label>
              <div className="flex justify-center gap-2.5 sm:gap-3">
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
                    className={`h-[72px] w-[60px] rounded-2xl border-2 text-center font-mono text-3xl text-foreground shadow-[inset_0_1px_2px_hsl(240_10%_20%/0.05)] transition-all duration-150 focus:-translate-y-0.5 focus:border-ring focus:bg-card focus:outline-none focus:ring-4 focus:ring-ring/15 sm:h-20 sm:w-16 ${error ? 'border-red-300 bg-red-50/60' : pin[i] ? 'border-[hsl(var(--slab-edge))] bg-[hsl(var(--cell))]' : 'border-border bg-secondary/60'}`}
                    autoFocus={i === 0}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 animate-fade-in" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {success && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 animate-fade-in">
                <p className="text-emerald-700 text-sm text-center flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {success}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || pin.length !== 4}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-medium text-primary-foreground shadow-[0_1px_2px_hsl(240_10%_10%/0.2),0_8px_20px_-8px_hsl(240_10%_10%/0.45)] transition-all duration-150 hover:bg-primary/90 focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
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

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/login')}
            className="mx-auto flex h-10 items-center gap-2 rounded-xl px-4 text-sm text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Обычный вход (email + пароль)
          </button>
        </div>
      </div>
    </div>
  );
}