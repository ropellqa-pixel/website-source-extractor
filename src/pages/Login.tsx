import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Lock, User, LogIn, Zap, AlertCircle, Loader2 } from 'lucide-react';
import AnodBizLogo from '../components/AnodBizLogo';
import { SITE_VERSION } from '@/lib/apiUrls';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неверный email или пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-bg flex min-h-[100dvh] items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-[420px] reveal-up">
        <div className="mb-8 text-center">
          <AnodBizLogo size="lg" className="drop-shadow-[0_18px_30px_hsl(222_47%_11%/0.3)]" />
          <h1 className="mb-1.5 mt-5 font-head text-[30px] font-extrabold tracking-[-0.04em] text-foreground">АнодБИЗ</h1>
          <p className="text-[15px] text-muted-foreground">Платформа для управления бизнесом</p>
        </div>

        <div className="rounded-3xl border border-white/70 bg-card/90 p-6 shadow-pop backdrop-blur-xl sm:p-8">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">Вход в систему</h2>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">Введите рабочий email и пароль</p>
          
          {error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 animate-fade-in" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-foreground/80">Email</label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 w-full rounded-xl border border-input bg-card pl-11 pr-4 text-base text-foreground shadow-[inset_0_1px_2px_hsl(240_10%_20%/0.04)] transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-foreground/20 focus:border-ring focus:outline-none focus:ring-4 focus:ring-ring/15"
                  placeholder="Введите email"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-foreground/80">Пароль</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 w-full rounded-xl border border-input bg-card pl-11 pr-4 text-base text-foreground shadow-[inset_0_1px_2px_hsl(240_10%_20%/0.04)] transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-foreground/20 focus:border-ring focus:outline-none focus:ring-4 focus:ring-ring/15"
                  placeholder="Введите пароль"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="!mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-medium text-primary-foreground shadow-[0_1px_2px_hsl(240_10%_10%/0.2),0_8px_20px_-8px_hsl(240_10%_10%/0.45)] transition-all duration-150 hover:bg-primary/90 focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border"></div>
            <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">или</span>
            <div className="h-px flex-1 bg-border"></div>
          </div>

          <button
            onClick={() => navigate('/pin-login')}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 font-medium text-foreground shadow-soft transition-all duration-150 hover:border-foreground/20 hover:bg-secondary/60 focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/25 active:scale-[0.98]"
          >
            <Zap className="h-5 w-5 text-[hsl(var(--day))]" />
            Быстрый вход по пин-коду
          </button>

        </div>

        <div className="mt-6 text-center text-[13px] text-muted-foreground">
          © 2026 АнодБИЗ. Все права защищены.{SITE_VERSION && <span className="block mt-1 text-xs">Версия {SITE_VERSION}</span>}
        </div>
      </div>
    </div>
  );
}