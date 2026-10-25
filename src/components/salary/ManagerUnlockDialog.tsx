import { Unlock } from 'lucide-react';

interface Props {
  unlockCode: string;
  unlockError: string;
  onCodeChange: (v: string) => void;
  onClose: () => void;
  onUnlock: () => void;
}

export default function ManagerUnlockDialog({ unlockCode, unlockError, onCodeChange, onClose, onUnlock }: Props) {
  return (
    <div className="fixed inset-0 bg-foreground/30 flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="bg-card rounded-2xl p-6 w-80 border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Unlock className="w-5 h-5 text-amber-600" />
          <h3 className="text-foreground font-semibold">Разблокировка таблицы</h3>
        </div>
        <p className="text-muted-foreground text-sm mb-4">Введите код для разблокировки таблицы «Заведующий»:</p>
        <input type="password" value={unlockCode} onChange={(e) => onCodeChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onUnlock()}
          className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground text-center text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-amber-500 mb-3"
          placeholder="••••" autoFocus />
        {unlockError && <p className="text-red-600 text-sm mb-3">{unlockError}</p>}
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 bg-secondary hover:bg-border text-foreground py-2 rounded-lg transition-all text-sm">Отмена</button>
          <button onClick={onUnlock}
            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg transition-all text-sm">Разблокировать</button>
        </div>
      </div>
    </div>
  );
}
