import { useMemo, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import type { SberCp } from '@/lib/sberApi';

interface Props {
  items: SberCp[];
  value: string;
  onChange: (id: string) => void;
}

export default function CounterpartyPicker({ items, value, onChange }: Props) {
  const selected = items.find((c) => String(c.id) === value);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(!value);
  const inputRef = useRef<HTMLInputElement>(null);

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.name.toLowerCase().includes(q) || (c.inn || '').includes(q));
  }, [items, query]);

  const pick = (c: SberCp) => { onChange(String(c.id)); setQuery(''); setOpen(false); };

  if (selected && !open) {
    return (
      <button type="button" onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="flex h-10 w-full items-center gap-2 rounded-md border bg-background px-3 text-left text-sm hover:bg-secondary/50">
        <span className="flex-1 truncate font-medium">{selected.name}</span>
        <span className="text-xs text-muted-foreground">{selected.inn ? `ИНН ${selected.inn}` : ''}</span>
        <Icon name="ChevronsUpDown" size={14} className="text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input ref={inputRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found[0]) { e.preventDefault(); pick(found[0]); }
            if (e.key === 'Escape' && selected) { e.stopPropagation(); setOpen(false); }
          }}
          placeholder="Начните вводить название или ИНН"
          className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>
      <div className="mt-1 max-h-52 overflow-auto rounded-md border bg-card">
        {found.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">Ничего не найдено</div>
        ) : found.map((c) => (
          <button type="button" key={c.id} onClick={() => pick(c)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary ${String(c.id) === value ? 'bg-secondary' : ''}`}>
            <span className="flex-1 truncate">{c.name}</span>
            {c.inn && <span className="text-xs text-muted-foreground">{c.inn}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
