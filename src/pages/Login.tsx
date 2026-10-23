import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Lock, User, LogIn, Zap, AlertCircle, Loader2, IdCard } from 'lucide-react';
import AnodBizLogo from '../components/AnodBizLogo';
import { SITE_VERSION } from '@/lib/apiUrls';
import { looksLikeCard } from '@/lib/cardsApi';

const READER_GAP_MS = 50;

function readerChar(e: KeyboardEvent): string | null {
  const code = e.code || '';
  let m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Key([A-F])$/.exec(code);
  if (m) return m[1];
  if (code === 'Comma' || code === 'Period' || code === 'NumpadDecimal') return ',';
  if (!code && e.key.length === 1 && /[0-9A-Fa-f,.]/.test(e.key)) return e.key.toUpperCase();
  return null;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const { signIn, signInWithCard } = useAuth();
  const navigate = useNavigate();
  const bufRef = useRef<{ chars: string; last: number }>({ chars: '', last: 0 });
  const cardBusyRef = useRef(false);
  const signInWithCardRef = useRef(signInWithCard);
  signInWithCardRef.current = signInWithCard;

  useEffect(() => {
    const loginByCard = async (raw: string) => {
      if (cardBusyRef.current) return;
      cardBusyRef.current = true;
      setCardBusy(true);
      setError('');
      try {
        await signInWithCardRef.current(raw);
        navigate('/dashboard');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось войти по карте');
      } finally {
        cardBusyRef.current = false;
        setCardBusy(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const now = performance.now();
      const b = bufRef.current;
      const fast = now - b.last < READER_GAP_MS;
      if (e.key === 'Enter') {
        const raw = b.chars;
        const ok = fast && raw.length >= 6 && looksLikeCard(raw);
        b.chars = '';
        b.last = 0;
        if (!ok) return;
        e.preventDefault();
        e.stopPropagation();
        const target = e.target as HTMLElement | null;
        if (target instanceof HTMLInputElement) {
          const strip = (v: string) => (v.length >= raw.length ? v.slice(0, -raw.length) : '');
          if (target.type === 'password') setPassword(strip);
          else setEmail(strip);
        }
        void loginByCard(raw);
        return;
      }
      if (e.key === 'Shift') return;
      const ch = e.ctrlKey || e.altKey || e.metaKey ? null : readerChar(e);
      if (!ch) {
        b.chars = '';
        b.last = 0;
        return;
      }
      b.chars = fast ? b.chars + ch : ch;
      b.last = now;
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [navigate]);

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
              disabled={loading || cardBusy}
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

          <div
            className={`mb-3 flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 transition-colors ${cardBusy ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/40'}`}
            aria-live="polite"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card shadow-soft">
              {cardBusy ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <IdCard className="h-5 w-5 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{cardBusy ? 'Вход по карте...' : 'Приложите карту доступа'}</p>
              <p className="text-xs text-muted-foreground">К считывателю — вход выполнится автоматически</p>
            </div>
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
