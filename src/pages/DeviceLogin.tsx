import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('Ссылка неполная: отсутствует код входа.');
      return;
    }
    const next = searchParams.get('next') || '';
    const target = /^\/[a-z0-9/-]*$/i.test(next) ? next : '/dashboard';
    signInWithLoginCode(code)
      .then(() => navigate(target, { replace: true }))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Не удалось выполнить вход.');
      });
  }, [searchParams, signInWithLoginCode, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <AnodBizLogo size="lg" />
        <h1 className="font-head text-2xl font-extrabold tracking-[-0.04em] text-foreground mb-2 mt-4">АнодБИЗ</h1>

        {error ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mt-6 text-left">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <p className="text-red-600 font-medium">Не удалось войти</p>
            </div>
            <p className="text-red-600/90 text-sm">{error}</p>
            <a href="/login" className="inline-block mt-3 text-blue-600 hover:text-blue-700 font-medium text-sm">
              Войти вручную
            </a>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 mt-6 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Выполняется вход...
          </div>
        )}
      </div>
    </div>
  );
}
