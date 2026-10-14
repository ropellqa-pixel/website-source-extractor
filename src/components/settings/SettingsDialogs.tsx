import { Dispatch, SetStateAction } from 'react';
import { Lock, RefreshCw, Check, AlertTriangle } from 'lucide-react';

interface Props {
  showPercentLock: boolean;
  setShowPercentLock: Dispatch<SetStateAction<boolean>>;
  percentCode: string;
  setPercentCode: Dispatch<SetStateAction<string>>;
  percentError: string;
  setPercentError: Dispatch<SetStateAction<string>>;
  handleLockPercent: () => void;
  showRevokeConfirm: boolean;
  setShowRevokeConfirm: Dispatch<SetStateAction<boolean>>;
  handleRevokeApiToken: () => void;
}

export default function SettingsDialogs({
  showPercentLock, setShowPercentLock, percentCode, setPercentCode, percentError, setPercentError, handleLockPercent,
  showRevokeConfirm, setShowRevokeConfirm, handleRevokeApiToken,
}: Props) {
  return (
    <>
    {showPercentLock && (
      <div className="fixed inset-0 bg-foreground/30 flex items-center justify-center z-[100]" onClick={() => setShowPercentLock(false)}>
        <div className="bg-card rounded-2xl p-6 w-80 border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-emerald-600" />
            <h3 className="text-foreground font-semibold">Блокировка процента</h3>
          </div>
          <input type="password" value={percentCode}
            onChange={(e) => { setPercentCode(e.target.value); setPercentError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleLockPercent()}
            className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground text-center text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-3"
            placeholder="••••" autoFocus />
          {percentError && <p className="text-red-600 text-sm mb-3">{percentError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowPercentLock(false); setPercentCode(''); setPercentError(''); }}
              className="flex-1 bg-secondary hover:bg-border text-foreground py-2 rounded-lg transition-all text-sm">Отмена</button>
            <button onClick={handleLockPercent}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg transition-all flex items-center justify-center gap-1 text-sm">
              <Check className="w-4 h-4" /> Подтвердить
            </button>
          </div>
        </div>
      </div>
    )}

    {showRevokeConfirm && (
      <div className="fixed inset-0 bg-foreground/30 flex items-center justify-center z-[100]" onClick={() => setShowRevokeConfirm(false)}>
        <div className="bg-card rounded-2xl p-6 w-96 border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h3 className="text-foreground font-semibold">Отозвать ключ доступа?</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Текущий ключ перестанет работать немедленно. Десктоп-приложение потеряет доступ, пока не введёшь новый ключ в его настройках.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setShowRevokeConfirm(false)}
              className="flex-1 bg-secondary hover:bg-border text-foreground py-2 rounded-lg transition-all text-sm">Отмена</button>
            <button onClick={handleRevokeApiToken}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg transition-all flex items-center justify-center gap-1 text-sm">
              <RefreshCw className="w-4 h-4" /> Отозвать
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
