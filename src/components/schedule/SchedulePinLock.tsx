import { useEffect, useRef, useState, ReactNode } from 'react';
import Icon from '@/components/ui/icon';

const PIN = '2535';
const STORAGE_KEY = 'schedule_unlocked';

function isUnlocked(): boolean {
  try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

interface SchedulePinLockProps {
  children: ReactNode;
  onBack?: () => void;
}

export default function SchedulePinLock({ children, onBack }: SchedulePinLockProps) {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (pin.length !== 4) return;
    if (pin === PIN) {
      try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch { /* noop */ }
      setUnlocked(true);
      return;
    }
    setError(true);
    setShake(true);
    const t = setTimeout(() => {
      setShake(false);
      setPin('');
      inputs.current[0]?.focus();
    }, 450);
    return () => clearTimeout(t);
  }, [pin]);

  if (unlocked) return <>{children}</>;

  const press = (digit: string) => {
    if (pin.length >= 4) return;
    setError(false);
    setPin(p => p + digit);
    inputs.current[Math.min(pin.length + 1, 3)]?.focus();
  };

  const backspace = () => {
    setError(false);
    setPin(p => p.slice(0, -1));
    inputs.current[Math.max(pin.length - 1, 0)]?.focus();
  };

  return (
    <div className="auth-bg flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <style>{`@keyframes schedPinShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(10px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
      <div className="w-full max-w-[400px] reveal-up">
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-5 rounded-[22px] bg-gradient-to-br from-[hsl(var(--logo-1))] to-[hsl(var(--logo-2))] shadow-[0_18px_30px_-8px_hsl(222_47%_11%/0.45)]">
            <Icon name="LockKeyhole" className="h-9 w-9 text-[hsl(var(--logo-bar))]" />
          </div>
          <h1 className="mb-1.5 font-head text-[26px] font-bold tracking-[-0.04em] text-foreground">Табель защищён</h1>
          <p className="text-muted-foreground">Введите пин-код раздела, чтобы продолжить</p>
        </div>

        <div className="rounded-3xl border border-white/70 bg-card/90 p-6 shadow-pop backdrop-blur-xl sm:p-8">
          <div
            className="flex justify-center gap-2.5 sm:gap-3"
            style={shake ? { animation: 'schedPinShake 0.42s ease-in-out' } : undefined}
          >
            {[0, 1, 2, 3].map(i => (
              <input
                key={i}
                ref={el => { inputs.current[i] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                autoFocus={i === 0}
                value={pin[i] || ''}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '').slice(-1);
                  if (!val) return;
                  setError(false);
                  const arr = pin.split('');
                  arr[i] = val;
                  const joined = arr.join('').slice(0, 4);
                  setPin(joined);
                  if (i < 3) inputs.current[i + 1]?.focus();
                }}
                onKeyDown={e => {
                  if (e.key === 'Backspace') {
                    e.preventDefault();
                    backspace();
                  }
                }}
                className={`h-[68px] w-[58px] rounded-2xl border-2 text-center font-mono text-3xl text-foreground transition-all duration-150 focus:-translate-y-0.5 focus:border-ring focus:bg-card focus:outline-none focus:ring-4 focus:ring-ring/15 sm:h-[76px] sm:w-16 ${error ? 'border-red-300 bg-red-50/60' : pin[i] ? 'border-[hsl(var(--slab-edge))] bg-[hsl(var(--cell))]' : 'border-border bg-secondary/60'}`}
              />
            ))}
          </div>

          <div className="h-10 mt-3 flex items-center justify-center">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 animate-fade-in" role="alert">
                <Icon name="CircleAlert" className="h-4 w-4 text-red-600" />
                <span className="text-sm text-red-700">Неверный пин-код</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2.5 mt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => press(d)}
                className="h-14 rounded-2xl bg-secondary/70 text-xl font-semibold text-foreground transition-all hover:bg-secondary active:scale-95"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={onBack}
              className="h-14 rounded-2xl text-muted-foreground transition-all hover:bg-secondary active:scale-95 flex items-center justify-center"
              aria-label="Назад"
            >
              <Icon name="ArrowLeft" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => press('0')}
              className="h-14 rounded-2xl bg-secondary/70 text-xl font-semibold text-foreground transition-all hover:bg-secondary active:scale-95"
            >
              0
            </button>
            <button
              type="button"
              onClick={backspace}
              className="h-14 rounded-2xl text-muted-foreground transition-all hover:bg-secondary active:scale-95 flex items-center justify-center"
              aria-label="Стереть"
            >
              <Icon name="Delete" className="h-5 w-5" />
            </button>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <Icon name="ShieldCheck" className="h-3.5 w-3.5" />
          Доступ сохранится до закрытия вкладки
        </p>
      </div>
    </div>
  );
}
