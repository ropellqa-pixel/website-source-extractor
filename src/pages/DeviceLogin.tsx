import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Loader2, AlertTriangle } from 'lucide-react';
import AnodBizLogo from '../components/AnodBizLogo';

/**
 * Страница автовхода для десктоп-приложения: программа получает одноразовый код
 * (action request_login_link) и сама открывает браузер по адресу /device-login?code=...
 * Страница обменивает код на сессию и сразу переходит в личный кабинет —
 * без ручного ввода логина и пароля.
 */
export default function DeviceLogin() {
  const [searchParams] = useSearchParams();
  const { signInWithLoginCode } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const handledCode = useRef<string | null>(null);
  const signInRef = useRef(signInWithLoginCode);
  signInRef.current = signInWithLoginCode;

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('Ссылка неполная: отсутствует код входа.');
      return;
    }
    if (handledCode.current === code) return;
    handledCode.current = code;
    const next = searchParams.get('next') || '';
    const target = /^\/[a-z0-9/-]*$/i.test(next) ? next : '/dashboard';
    signInRef.current(code)
      .then(() => navigate(target, { replace: true }))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Не удалось выполнить вход.');
      });
  }, [searchParams, navigate]);

  return (
    <div className="auth-bg flex min-h-[100dvh] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/70 bg-card/90 p-8 text-center shadow-pop backdrop-blur-xl reveal-up">
        <AnodBizLogo size="lg" className="drop-shadow-[0_18px_30px_hsl(222_47%_11%/0.3)]" />
        <h1 className="font-head text-2xl font-extrabold tracking-[-0.04em] text-foreground mb-2 mt-4">АнодБИЗ</h1>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-left">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <p className="text-red-600 font-medium">Не удалось войти</p>
            </div>
            <p className="text-sm text-red-700">{error}</p>
            <a href="/login" className="mt-3 inline-flex h-9 items-center rounded-lg bg-card px-3 text-sm font-medium text-link shadow-soft hover:underline">
              Войти вручную
            </a>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 mt-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--day))]" />
            Выполняется вход...
          </div>
        )}
      </div>
    </div>
  );
}
