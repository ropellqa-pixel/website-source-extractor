import Icon from '@/components/ui/icon';
import {
  ConfigParams,
  ConfiguratorTemplate,
  ParamDef,
  SHIFT_CELL_COLORS,
  SHIFT_CODES,
  WEEKDAYS,
  absDay,
  cycleText,
  getArr,
  getNum,
  getStr,
  modeDayRule,
  parseCycle,
  weekdayOf,
} from './configuratorCatalog';

export interface EmployeeOption {
  id: string;
  full_name: string;
}

const inputCls = 'w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function chip(active: boolean, color = '') {
  return `px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${active ? `${color || 'bg-primary text-primary-foreground'} border-transparent ring-2 ring-ring/30` : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'}`;
}

function codeOptions(def: ParamDef): { value: string; label: string }[] {
  const list = SHIFT_CODES.map(c => ({ value: c as string, label: c as string }));
  if (def.withAny) list.unshift({ value: '*', label: 'Любая' });
  if (def.withRest) list.push({ value: '', label: 'Выходной' });
  return list;
}

function Field({ def, params, onChange, employees, selfId }: {
  def: ParamDef; params: ConfigParams; onChange: (key: string, v: ConfigParams[string]) => void; employees: EmployeeOption[]; selfId?: string;
}) {
  switch (def.type) {
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <input type="number" min={def.min} max={def.max} step={def.step || 1} value={getNum(params, def.key, Number(def.default))}
            onChange={e => onChange(def.key, Number(e.target.value))} className={`${inputCls} w-28`} />
          {def.suffix && <span className="text-sm text-muted-foreground">{def.suffix}</span>}
        </div>
      );
    case 'select':
      return (
        <select value={getStr(params, def.key, String(def.default))} onChange={e => onChange(def.key, e.target.value)} className={inputCls}>
          {(def.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'text':
      return <input type="text" value={getStr(params, def.key)} placeholder={def.placeholder} onChange={e => onChange(def.key, e.target.value)} className={inputCls} />;
    case 'code': {
      const cur = getStr(params, def.key, String(def.default));
      return (
        <div className="flex flex-wrap gap-2">
          {codeOptions(def).map(o => (
            <button key={o.value || 'rest'} type="button" onClick={() => onChange(def.key, o.value)}
              className={chip(cur === o.value, o.value === '*' ? '' : SHIFT_CELL_COLORS[o.value])}>
              {o.label}
            </button>
          ))}
        </div>
      );
    }
    case 'codes': {
      const cur = getArr<string>(params, def.key);
      return (
        <div className="flex flex-wrap gap-2">
          {SHIFT_CODES.map(c => (
            <button key={c} type="button" className={chip(cur.includes(c), SHIFT_CELL_COLORS[c])}
              onClick={() => onChange(def.key, cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c])}>
              {c}
            </button>
          ))}
        </div>
      );
    }
    case 'weekdays': {
      const cur = getArr<number>(params, def.key).map(Number);
      return (
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map(w => (
            <button key={w.value} type="button"
              className={`${chip(cur.includes(w.value))} w-12 ${w.value >= 6 && !cur.includes(w.value) ? 'text-rose-500' : ''}`}
              onClick={() => onChange(def.key, cur.includes(w.value) ? cur.filter(x => x !== w.value) : [...cur, w.value].sort())}>
              {w.short}
            </button>
          ))}
        </div>
      );
    }
    case 'employee':
      return (
        <select value={getStr(params, def.key)} onChange={e => onChange(def.key, e.target.value)} className={inputCls}>
          <option value="">— выберите сотрудника —</option>
          {employees.filter(e => e.id !== selfId).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      );
    case 'cycle': {
      const text = getStr(params, def.key);
      const parsed = parseCycle(text);
      const append = (c: string) => onChange(def.key, [...parsed.map(x => x || 'В'), c || 'В'].join(','));
      return (
        <div className="space-y-2">
          <input type="text" value={text} placeholder={def.placeholder} onChange={e => onChange(def.key, e.target.value)} className={inputCls} />
          <div className="flex flex-wrap items-center gap-1.5">
            {[...SHIFT_CODES, ''].map(c => (
              <button key={c || 'rest'} type="button" onClick={() => append(c)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold ${SHIFT_CELL_COLORS[c]} hover:opacity-80`}>
                + {c || 'В'}
              </button>
            ))}
            {parsed.length > 0 && (
              <button type="button" onClick={() => onChange(def.key, parsed.slice(0, -1).map(x => x || 'В').join(','))}
                className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary flex items-center gap-1">
                <Icon name="Undo2" className="w-3 h-3" /> убрать
              </button>
            )}
          </div>
          {parsed.length > 0 && <p className="text-xs text-muted-foreground">{cycleText(parsed)}</p>}
        </div>
      );
    }
    default:
      return null;
  }
}

export function ConfiguratorParamFields({ template, params, onChange, employees }: {
  template: ConfiguratorTemplate; params: ConfigParams; onChange: (p: ConfigParams) => void; employees: EmployeeOption[];
}) {
  if (!template.params.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Icon name="Info" className="w-4 h-4" /> У этого шаблона нет параметров — достаточно сохранить.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {template.params.map(def => (
        <div key={def.key}>
          <label className="block text-sm font-medium text-foreground mb-1.5">{def.label}</label>
          <Field def={def} params={params} employees={employees} onChange={(k, v) => onChange({ ...params, [k]: v })} />
          {def.hint && <p className="text-xs text-muted-foreground mt-1">{def.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function ModePreview({ params, days = 14 }: { params: ConfigParams; days?: number }) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d0 = today.getDate() - 1;
  const cells = Array.from({ length: days }, (_, i) => {
    const date = new Date(y, m, d0 + 1 + i);
    const wd = weekdayOf(y, m, d0 + i);
    const r = modeDayRule(params, absDay(y, m, d0 + i), wd);
    let code = '';
    let label = '';
    if (r?.must) code = r.must;
    else if (r?.allow) { code = r.allow[0]; label = r.allow.join('/'); }
    else if (!r) label = '~';
    return { date, wd, code, label, free: params.template === 'mode_floating' && getArr<number>(params, 'free').map(Number).includes(wd) };
  });
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Предпросмотр на 14 дней</p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(days, 14)}, minmax(0, 1fr))` }}>
        {cells.map((c, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <span className={`text-[10px] ${c.wd >= 6 ? 'text-rose-500' : 'text-muted-foreground'}`}>{WEEKDAYS[c.wd - 1].short}</span>
            <div className={`w-full aspect-square rounded-md flex items-center justify-center text-xs font-bold ${c.free ? 'bg-slate-100 text-slate-400 ring-1 ring-rose-200' : SHIFT_CELL_COLORS[c.code] || SHIFT_CELL_COLORS['']}`}>
              {c.label || c.code || 'В'}
            </div>
            <span className="text-[10px] text-muted-foreground">{c.date.getDate()}</span>
          </div>
        ))}
      </div>
      {(params.template === 'mode_floating' || params.template === 'mode_part_time') && (
        <p className="text-xs text-muted-foreground mt-2">Конкретные дни подберёт генератор с учётом лимитов.</p>
      )}
    </div>
  );
}
