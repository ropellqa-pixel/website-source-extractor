import { useState } from 'react';
import Icon from '@/components/ui/icon';
import KindBadge from './KindBadge';
import { ConfiguratorKind, ConfiguratorRecord, KIND_META, summarize } from './configuratorCatalog';

interface Props {
  configurators: ConfiguratorRecord[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  employeeName?: (id: string) => string;
}

const KINDS: ConfiguratorKind[] = ['mode', 'condition', 'function'];

export default function EmployeeConfiguratorPicker({ configurators, selectedIds, onChange, employeeName }: Props) {
  const [query, setQuery] = useState('');
  const ctx = { employeeName: employeeName || (() => '') };
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  const q = query.trim().toLowerCase();
  const filtered = configurators.filter(c => !q || c.name.toLowerCase().includes(q));
  const missing = selectedIds.filter(id => !configurators.some(c => c.id === id));

  return (
    <div className="bg-card rounded-lg p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <Icon name="SlidersHorizontal" className="w-4 h-4 text-primary" /> Конфигураторы
        </label>
        <span className="text-xs text-muted-foreground">Выбрано: {selectedIds.length - missing.length}</span>
      </div>
      {configurators.length === 0 ? (
        <p className="text-xs text-muted-foreground">Конфигураторы ещё не созданы. Их создаёт зам. директора кнопкой «Конфигуратор» в табеле.</p>
      ) : (
        <>
          {configurators.length > 6 && (
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск..."
              className="w-full mb-2 bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          )}
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {KINDS.map(k => {
              const items = filtered.filter(c => c.kind === k);
              if (!items.length) return null;
              return (
                <div key={k}>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{KIND_META[k].plural}</p>
                  <div className="space-y-1.5">
                    {items.map(c => {
                      const on = selectedIds.includes(c.id);
                      return (
                        <button key={c.id} type="button" onClick={() => toggle(c.id)}
                          className={`w-full flex items-start gap-2.5 text-left p-2 rounded-lg border transition-all ${on ? 'border-primary/40 bg-primary/5' : 'border-border bg-secondary/40 hover:bg-secondary'} ${c.is_active ? '' : 'opacity-60'}`}>
                          <span className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center ${on ? 'bg-primary border-primary text-primary-foreground' : 'border-border bg-card'}`}>
                            {on && <Icon name="Check" className="w-3 h-3" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium text-foreground">{c.name}</span>
                              <KindBadge kind={c.kind} />
                              {!c.is_active && <span className="text-[11px] text-muted-foreground">выключен</span>}
                            </span>
                            <span className="block text-xs text-muted-foreground truncate">{summarize(c, ctx)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground mt-2">Можно выбрать любое количество. Режим задаёт базовый график, условия ограничивают расстановку, функции добавляют логику.</p>
    </div>
  );
}
