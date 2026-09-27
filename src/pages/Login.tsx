import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Lock, User, LogIn, Zap } from 'lucide-react';
import AnodBizLogo from '../components/AnodBizLogo';

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <AnodBizLogo size="lg" />
          <h1 className="font-head text-3xl font-extrabold tracking-[-0.04em] text-foreground mb-2 mt-4">АнодБИЗ</h1>
          <p className="text-muted-foreground">Платформа для работы с документами</p>
        </div>

        <div className="bg-card backdrop-blur-sm rounded-[22px] shadow-[0_30px_60px_-30px_hsl(var(--logo-2)/0.25)] p-8 border border-border">
          <h2 className="text-xl font-semibold text-foreground mb-6">Вход в систему</h2>
          
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Email</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                  placeholder="Введите email"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                  placeholder="Введите пароль"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white font-medium py-3 px-4 rounded-full hover:bg-primary/85 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="flex-1 h-px bg-secondary"></div>
            <span className="text-muted-foreground text-sm">или</span>
            <div className="flex-1 h-px bg-secondary"></div>
          </div>

          <button
            onClick={() => navigate('/pin-login')}
            className="w-full bg-secondary text-foreground border border-border font-medium py-3 px-4 rounded-full hover:bg-border focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card transition-all duration-200 flex items-center justify-center gap-2"
          >
            <Zap className="w-5 h-5" />
            Быстрый вход по пин-коду
          </button>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground">
              Нет аккаунта?{' '}
              <a href="/register" className="text-blue-600 hover:text-blue-700 font-medium">
                Зарегистрировать компанию
              </a>
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-card/60 p-4 text-left text-[13px] text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Демо-доступ</p>
          <p>Директор: director@anodbiz.ru · пароль anodbiz · PIN 1234</p>
        </div>

        <div className="mt-6 text-center text-muted-foreground text-sm">
          © 2026 АнодБИЗ. Все права защищены.
        </div>
      </div>
    </div>
  );
}