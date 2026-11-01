import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { canInstall, isInsideAbizApp, isIos, isStandalone, onInstallChange, promptInstall } from '@/lib/pwa';

export default function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const [ready, setReady] = useState(canInstall());
  const [help, setHelp] = useState(false);
  useEffect(() => onInstallChange(() => setReady(canInstall())), []);

  if (isStandalone() || isInsideAbizApp()) return null;
  const mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!ready && !mobile) return null;

  const click = async () => {
    if (ready) { await promptInstall(); return; }
    setHelp((v) => !v);
  };

  return (
    <div className={compact ? '' : 'mb-2'}>
      <button onClick={click}
        className="flex w-full items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-left text-[13px] font-medium text-primary transition-colors hover:bg-primary/10">
        <Icon name="Smartphone" size={16} />
        <span className="flex-1">Установить приложение</span>
        <Icon name="Download" size={14} />
      </button>
      {help && (
        <p className="mt-1.5 rounded-lg bg-secondary/70 p-2 text-[12px] leading-snug text-muted-foreground">
          {isIos()
            ? 'В Safari нажмите «Поделиться» (квадрат со стрелкой) → «На экран „Домой“».'
            : 'В Chrome нажмите ⋮ (три точки вверху справа) → «Установить приложение» или «Добавить на главный экран».'}
        </p>
      )}
    </div>
  );
}
