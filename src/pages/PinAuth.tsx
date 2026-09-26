import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Loader2, CheckCircle2, XCircle, LogIn } from 'lucide-react';

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Загрузка */}
        {status === 'loading' && (
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-violet-500 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">{message}</p>
          </div>
        )}

        {/* Ввод пароля */}
        {status === 'need_password' && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl shadow-lg mb-4">
              <LogIn className="w-10 h-10 text-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Добро пожаловать!</h1>
            <p className="text-muted-foreground mb-6">{userName}</p>

            <div className="bg-card backdrop-blur-sm rounded-[22px] shadow-[0_30px_60px_-30px_hsl(var(--logo-2)/0.25)] p-8 border border-border">
              <p className="text-foreground/80 text-sm mb-4">
                Для завершения входа введите пароль от аккаунта:
              </p>
              
              <div className="bg-secondary rounded-lg p-3 mb-4">
                <p className="text-foreground text-sm font-medium">{profileEmail}</p>
              </div>

              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setLoginError('');
                  }}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                  placeholder="Введите пароль"
                  autoFocus
                  required
                />

                {loginError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    <p className="text-red-600 text-sm text-center">{loginError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loggingIn || !password}
                  className="w-full bg-secondary text-foreground border border-border font-medium py-3 px-4 rounded-lg hover:bg-border focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                className="mt-4 text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                ← Ввести другой пин-код
              </button>
            </div>
          </div>
        )}

        {/* Успех */}
        {status === 'success' && (
          <div className="text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <p className="text-foreground font-medium">{message}</p>
          </div>
        )}

        {/* Ошибка */}
        {status === 'error' && (
          <div className="text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-600">{message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
