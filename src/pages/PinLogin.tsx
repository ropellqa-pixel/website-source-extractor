import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/lib/sdk';
import { ArrowLeft, Zap, Loader2 } from 'lucide-react';

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
      const { data: pins, error: pinErr } = await db
        .from('pin_codes')
        .select('email')
        .eq('pin', pin)
        .limit(1);

      if (pinErr) {
        console.error('Pin lookup error:', pinErr);
        setError('Ошибка при проверке пин-кода');
        setLoading(false);
        return;
      }

      if (!pins || pins.length === 0) {
        setError('Неверный пин-код');
        setLoading(false);
        return;
      }

      const email = pins[0].email;

      if (!email) {
        setError('Пин-код найден, но email не привязан. Обратитесь к руководителю.');
        setLoading(false);
        return;
      }

      const { data: profiles } = await db
        .from('profiles')
        .select('full_name')
        .eq('email', email)
        .limit(1);

      const userName = profiles?.[0]?.full_name || 'Сотрудник';

      localStorage.setItem('biz_pin_match', JSON.stringify({
        userName,
        profileEmail: email,
      }));

      setSuccess(`Найден: ${userName}. Переход...`);
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl shadow-lg mb-4">
            <Zap className="w-10 h-10 text-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Быстрый вход</h1>
          <p className="text-muted-foreground">Введите пин-код для входа в АнодБИЗ</p>
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

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/login')}
            className="text-muted-foreground hover:text-foreground transition-colors text-sm flex items-center gap-2 mx-auto"
          >
            <ArrowLeft className="w-4 h-4" />
            Обычный вход (email + пароль)
          </button>
        </div>
      </div>
    </div>
  );
}