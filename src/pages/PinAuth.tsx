import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Loader2, CheckCircle2, XCircle, LogIn, AlertCircle } from 'lucide-react';

export default function PinAuth() {
  const navigate = useNavigate();
  const { user, signIn } = useAuth();
  const [status, setStatus] = useState<'loading' | 'need_password' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Проверка пин-кода...');
  const [profileEmail, setProfileEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    const handlePinAuth = async () => {
      const matchData = localStorage.getItem('biz_pin_match');

      if (!matchData) {
        setStatus('error');
        setMessage('Данные входа не найдены');
        setTimeout(() => navigate('/pin-login'), 2000);
        return;
      }

      try {
        const { userName: name, profileEmail: email } = JSON.parse(matchData);
        setUserName(name || 'Сотрудник');
        setProfileEmail(email || '');

        // Если уже авторизован — сразу на dashboard
        if (user) {
          localStorage.removeItem('biz_pin_match');
          setStatus('success');
          setMessage(`Добро пожаловать, ${name || 'Сотрудник'}!`);
          setTimeout(() => navigate('/dashboard'), 1000);
          return;
        }

        // Если есть email — показываем форму ввода пароля
        if (email) {
          setStatus('need_password');
          setMessage('');
          return;
        }

        // Нет email — ошибка
        setStatus('error');
        setMessage('Не удалось определить email для входа');
        localStorage.removeItem('biz_pin_match');
        setTimeout(() => navigate('/pin-login'), 2000);
      } catch (err) {
        setStatus('error');
        setMessage('Ошибка авторизации');
        localStorage.removeItem('biz_pin_match');
        setTimeout(() => navigate('/pin-login'), 2000);
      }
    };

    handlePinAuth();
  }, [navigate, user]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !profileEmail) return;

    setLoggingIn(true);
    setLoginError('');

    try {
      await signIn(profileEmail, password);
      // signIn бросит ошибку если неверный пароль
      localStorage.removeItem('biz_pin_match');
      setStatus('success');
      setMessage(`Добро пожаловать, ${userName}!`);
      setTimeout(() => navigate('/dashboard'), 1000);
    } catch (err: any) {
      const errMsg = err?.message || '';
      if (errMsg.includes('Invalid login credentials') || errMsg.includes('неверн') || errMsg.includes('невозможно') || errMsg.includes('check')) {
        setLoginError('Неверный email или пароль. Проверьте данные и попробуйте ещё раз.');
      } else if (errMsg.includes('Email not confirmed') || errMsg.includes('подтверд')) {
        setLoginError('Email не подтверждён. Проверьте почту или обратитесь к руководителю.');
      } else {
        setLoginError(errMsg || 'Неизвестная ошибка входа');
      }
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div className="auth-bg flex min-h-[100dvh] items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-[420px] reveal-up">
        {/* Загрузка */}
        {status === 'loading' && (
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-[hsl(var(--day))]" />
            <p className="text-muted-foreground">{message}</p>
          </div>
        )}

        {/* Ввод пароля */}
        {status === 'need_password' && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 mb-5 rounded-[22px] bg-gradient-to-br from-[hsl(var(--logo-1))] to-[hsl(var(--logo-2))] shadow-[0_18px_30px_-8px_hsl(222_47%_11%/0.45)]">
              <LogIn className="h-9 w-9 text-[hsl(var(--logo-bar))]" />
            </div>
            <h1 className="mb-1.5 font-head text-[26px] font-bold tracking-[-0.04em] text-foreground">Добро пожаловать!</h1>
            <p className="mb-6 font-medium text-muted-foreground">{userName}</p>

            <div className="rounded-3xl border border-white/70 bg-card/90 p-6 shadow-pop backdrop-blur-xl sm:p-8 text-left">
              <p className="text-foreground/80 text-sm mb-4">
                Для завершения входа введите пароль от аккаунта:
              </p>
              
              <div className="mb-4 rounded-xl border border-[hsl(var(--slab-edge))] bg-[hsl(var(--cell))] px-3.5 py-2.5">
                <p className="truncate text-sm font-medium text-[hsl(var(--day))]">{profileEmail}</p>
              </div>

              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setLoginError('');
                  }}
                  className="h-12 w-full rounded-xl border border-input bg-card px-4 text-base text-foreground shadow-[inset_0_1px_2px_hsl(240_10%_20%/0.04)] transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-foreground/20 focus:border-ring focus:outline-none focus:ring-4 focus:ring-ring/15"
                  placeholder="Введите пароль"
                  autoFocus
                  required
                />

                {loginError && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 animate-fade-in" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <p className="text-sm text-red-700">{loginError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loggingIn || !password}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-medium text-primary-foreground shadow-[0_1px_2px_hsl(240_10%_10%/0.2),0_8px_20px_-8px_hsl(240_10%_10%/0.45)] transition-all duration-150 hover:bg-primary/90 focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  {loggingIn ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Вход...
                    </>
                  ) : (
                    <>
                      <LogIn className="w-5 h-5" />
                      Войти
                    </>
                  )}
                </button>
              </form>

              <button
                onClick={() => {
                  localStorage.removeItem('biz_pin_match');
                  navigate('/pin-login');
                }}
                className="mx-auto mt-4 block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                ← Ввести другой пин-код
              </button>
            </div>
          </div>
        )}

        {/* Успех */}
        {status === 'success' && (
          <div className="text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/50"><CheckCircle2 className="h-8 w-8 text-emerald-600" /></div>
            <p className="text-foreground font-medium">{message}</p>
          </div>
        )}

        {/* Ошибка */}
        {status === 'error' && (
          <div className="text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-red-50 ring-8 ring-red-50/50"><XCircle className="h-8 w-8 text-red-600" /></div>
            <p className="text-red-700">{message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
