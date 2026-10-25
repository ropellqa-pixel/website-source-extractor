import { Save, Lock, Send, Loader2, CheckCircle } from 'lucide-react';

interface Props {
  showBroadcast: boolean;
  onBroadcast: () => void;
  broadcasting: boolean;
  rowsCount: number;
  showSave: boolean;
  onSave: () => void;
  saving: boolean;
  periodLocked: boolean;
  managerLocked: boolean;
  broadcastResult: string;
  onCloseResult: () => void;
}

export default function SalaryBottomBar({
  showBroadcast, onBroadcast, broadcasting, rowsCount, showSave, onSave, saving,
  periodLocked, managerLocked, broadcastResult, onCloseResult,
}: Props) {
  return (
    <div className="sticky bottom-0 bg-card backdrop-blur-sm border-t border-border px-4 py-3">
      <div className="max-w-full mx-auto flex items-center justify-end gap-3">
        {showBroadcast && <button onClick={onBroadcast} disabled={broadcasting || rowsCount === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {broadcasting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {broadcasting ? 'Отправка...' : 'Рассылка'}
        </button>}
        {showSave && (
          <button onClick={onSave} disabled={saving || (periodLocked && managerLocked)}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
            {periodLocked ? <Lock className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? 'Сохранение...' : (periodLocked && managerLocked) ? 'Заблокировано' : 'Сохранить'}
          </button>
        )}
      </div>
      {broadcastResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6 text-center">
            <div className={broadcastResult.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}>
              <CheckCircle className="w-10 h-10 mx-auto mb-3" />
            </div>
            <p className="text-foreground text-base leading-relaxed whitespace-pre-line">{broadcastResult}</p>
            <button
              onClick={onCloseResult}
              className="mt-5 w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all">
              Понятно
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
