import Icon from '@/components/ui/icon';

interface Props {
  hasFrame: boolean;
  stalled: boolean;
  error?: string | null;
  needTap?: boolean;
  onTap?: () => void;
  poster?: boolean;
}

export default function StreamOverlay({ hasFrame, stalled, error, needTap, onTap, poster }: Props) {
  if (needTap) {
    return (
      <button type="button" onClick={onTap} className="absolute inset-0 flex items-center justify-center bg-black/30">
        <span className="flex items-center gap-2 rounded-full bg-black/70 px-5 py-3 text-sm text-white">
          <Icon name="Play" size={18} /> Нажмите, чтобы смотреть
        </span>
      </button>
    );
  }
  if (error && (!hasFrame || stalled)) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="max-w-sm rounded-2xl bg-black/70 px-5 py-4 text-center text-sm text-white">
          <Icon name="VideoOff" size={28} className="mx-auto mb-2 opacity-70" />
          {error}
        </div>
      </div>
    );
  }
  if (!hasFrame && poster) {
    return (
      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/90">
        <Icon name="Loader2" size={14} className="animate-spin" /> Подключение к видео...
      </div>
    );
  }
  if (!hasFrame) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm text-white">
          <Icon name="Loader2" size={16} className="animate-spin" /> Подключение к камере...
        </div>
      </div>
    );
  }
  if (stalled) {
    return (
      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/90">
        <Icon name="Loader2" size={14} className="animate-spin" /> Переподключение...
      </div>
    );
  }
  return null;
}
