import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { bindCard, listCards, unbindCard, type LoginCard } from '@/lib/cardsApi';

interface Props {
  profileId: string;
  autoFocus?: boolean;
  notify?: (text: string, type?: 'success' | 'error') => void;
}

export default function CardAccessSection({ profileId, autoFocus = true, notify }: Props) {
  const [cards, setCards] = useState<LoginCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setCards(await listCards(profileId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить карты');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    setLoading(true);
    setCards([]);
    setError('');
    load();
  }, [load]);

  const submit = async (force = false) => {
    const raw = value.trim();
    if (!raw || busy) return;
    setBusy(true);
    setError('');
    try {
      const num = await bindCard(profileId, raw, force);
      setValue('');
      setConflict('');
      notify?.(`Карта ${num} привязана`, 'success');
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось привязать карту';
      if (msg.startsWith('Карта уже привязана')) setConflict(msg);
      else setError(msg);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const remove = async (card: string) => {
    if (!confirm(`Отвязать карту ${card}?`)) return;
    try {
      await unbindCard(card);
      setCards((list) => list.filter((c) => c.card_number !== card));
      notify?.('Карта отвязана', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отвязать карту');
    }
  };

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon name="IdCard" size={16} /> Карта доступа
      </div>

      {loading ? (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Icon name="Loader2" size={14} className="animate-spin" /> Загрузка...
        </div>
      ) : cards.length === 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">Карты не привязаны</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {cards.map((c) => (
            <span key={c.card_number} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1 font-mono text-xs text-foreground">
              {c.card_number}
              <button
                type="button"
                onClick={() => remove(c.card_number)}
                className="rounded-full p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                title="Отвязать карту"
              >
                <Icon name="X" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="flex gap-2"
      >
        <input
          ref={inputRef}
          data-abiz-card="1"
          value={value}
          onChange={(e) => { setValue(e.target.value); setConflict(''); setError(''); }}
          autoFocus={autoFocus}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Номер карты"
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={!value.trim() || busy}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/85 disabled:opacity-50"
        >
          {busy ? <Icon name="Loader2" size={14} className="animate-spin" /> : <Icon name="Plus" size={14} />}
          Привязать
        </button>
      </form>
      <p className="mt-1.5 text-xs text-muted-foreground">Приложите карту к считывателю — номер введётся сам</p>

      {conflict && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          {conflict}.
          <button type="button" onClick={() => submit(true)} className="ml-1 font-semibold underline">
            Перепривязать этому сотруднику
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
