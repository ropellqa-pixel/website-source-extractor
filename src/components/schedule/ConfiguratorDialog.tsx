import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  ConfigParams,
  ConfiguratorKind,
  ConfiguratorRecord,
  ConfiguratorTemplate,
  KIND_META,
  TEMPLATE_MAP,
  defaultParams,
  summarize,
  templatesOf,
} from './configuratorCatalog';
import { createConfigurator, deleteConfigurator, loadConfigurators, updateConfigurator } from './configuratorApi';
import { ConfiguratorParamFields, EmployeeOption, ModePreview } from './ConfiguratorParamFields';
import KindBadge from './KindBadge';

interface ConfiguratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId?: string;
  userId?: string;
  employees: EmployeeOption[];
  onChanged?: (list: ConfiguratorRecord[]) => void;
}

type View = 'list' | 'name' | 'kind' | 'edit';

interface Draft {
  id?: string;
  name: string;
  kind: ConfiguratorKind | null;
  params: ConfigParams | null;
}

const EMPTY_DRAFT: Draft = { name: '', kind: null, params: null };
const KINDS: ConfiguratorKind[] = ['condition', 'function', 'mode'];

export default function ConfiguratorDialog({ open, onOpenChange, companyId, userId, employees, onChanged }: ConfiguratorDialogProps) {
  const [list, setList] = useState<ConfiguratorRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('list');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ConfiguratorKind | 'all'>('all');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const ctx = useMemo(() => ({
    employeeName: (id: string) => employees.find(e => e.id === id)?.full_name || '',
  }), [employees]);

  const publish = (next: ConfiguratorRecord[]) => {
    setList(next);
    onChanged?.(next);
  };

  useEffect(() => {
    if (!open) return;
    setView('list');
    setDraft(EMPTY_DRAFT);
    setError('');
    setLoading(true);
    loadConfigurators(companyId).then(r => { setList(r); setLoading(false); });
  }, [open, companyId]);

  const template: ConfiguratorTemplate | undefined = draft.params ? TEMPLATE_MAP.get(draft.params.template) : undefined;

  const startCreate = () => { setDraft(EMPTY_DRAFT); setError(''); setView('name'); };
  const startEdit = (c: ConfiguratorRecord) => {
    const tpl = TEMPLATE_MAP.get(c.params?.template);
    setDraft({ id: c.id, name: c.name, kind: c.kind, params: tpl ? { ...defaultParams(tpl), ...c.params } : null });
    setError('');
    setView('edit');
  };

  const pickKind = (k: ConfiguratorKind) => {
    const first = templatesOf(k)[0];
    setDraft(d => ({ ...d, kind: k, params: d.kind === k && d.params ? d.params : defaultParams(first) }));
    setView('edit');
  };

  const pickTemplate = (tpl: ConfiguratorTemplate) => setDraft(d => ({ ...d, params: defaultParams(tpl) }));

  const save = async () => {
    if (!draft.name.trim()) { setError('Введите название'); setView('name'); return; }
    if (!draft.kind || !draft.params || !template) { setError('Выберите шаблон'); return; }
    const emp = template.params.find(p => p.type === 'employee');
    if (emp && !draft.params[emp.key]) { setError('Выберите сотрудника'); return; }
    setSaving(true);
    setError('');
    try {
      if (draft.id) {
        await updateConfigurator(draft.id, { name: draft.name.trim(), kind: draft.kind, params: draft.params });
        publish(list.map(c => (c.id === draft.id ? { ...c, name: draft.name.trim(), kind: draft.kind!, params: draft.params! } : c)));
      } else {
        const created = await createConfigurator({
          name: draft.name.trim(), kind: draft.kind, params: draft.params,
          ...(companyId ? { company_id: companyId } : {}), ...(userId ? { created_by: userId } : {}),
        });
        if (created) publish([...list, created]);
        else publish(await loadConfigurators(companyId));
      }
      setView('list');
      setDraft(EMPTY_DRAFT);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: ConfiguratorRecord, v: boolean) => {
    publish(list.map(x => (x.id === c.id ? { ...x, is_active: v } : x)));
    try { await updateConfigurator(c.id, { is_active: v }); } catch { publish(list); }
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    const prev = list;
    publish(list.filter(c => c.id !== id));
    try { await deleteConfigurator(id); } catch { publish(prev); }
  };

  const shown = filter === 'all' ? list : list.filter(c => c.kind === filter);
  const steps: { key: View; label: string }[] = [
    { key: 'name', label: 'Название' },
    { key: 'kind', label: 'Тип' },
    { key: 'edit', label: 'Параметры' },
  ];
  const stepIdx = steps.findIndex(s => s.key === view);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[calc(100%-16px)] p-0 sm:p-0 gap-0 overflow-hidden flex flex-col max-h-[calc(100dvh-24px)]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border text-left">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <span className="inline-flex w-9 h-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon name="SlidersHorizontal" className="w-5 h-5" />
            </span>
            Конфигуратор табеля
          </DialogTitle>
          <DialogDescription>
            Условия, функции и режимы работы, которые можно назначать сотрудникам в постоянных настройках.
          </DialogDescription>
          {view !== 'list' && (
            <div className="flex items-center gap-2 pt-3">
              {steps.map((s, i) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${i === stepIdx ? 'bg-primary text-primary-foreground' : i < stepIdx || draft.id ? 'bg-emerald-50 text-emerald-700' : 'bg-secondary text-muted-foreground'}`}>
                    {i < stepIdx ? <Icon name="Check" className="w-3 h-3" /> : <span>{i + 1}</span>}
                    {s.label}
                  </span>
                  {i < steps.length - 1 && <Icon name="ChevronRight" className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {view === 'list' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {(['all', ...KINDS] as const).map(k => (
                    <button key={k} onClick={() => setFilter(k)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === k ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                      {k === 'all' ? `Все (${list.length})` : `${KIND_META[k].plural} (${list.filter(c => c.kind === k).length})`}
                    </button>
                  ))}
                </div>
                <button onClick={startCreate} className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90">
                  <Icon name="Plus" className="w-4 h-4" /> Создать
                </button>
              </div>

              {loading ? (
                <div className="py-16 flex justify-center"><Icon name="Loader2" className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : shown.length === 0 ? (
                <div className="py-14 text-center border-2 border-dashed border-border rounded-2xl">
                  <Icon name="PackageOpen" className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium text-foreground">Конфигураторов пока нет</p>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">Создайте первое условие, функцию или режим работы</p>
                  <button onClick={startCreate} className="inline-flex items-center gap-2 px-4 py-2 bg-secondary rounded-lg text-sm font-medium hover:bg-border">
                    <Icon name="Plus" className="w-4 h-4" /> Создать
                  </button>
                </div>
              ) : (
                <div className="grid gap-2.5">
                  {shown.map(c => {
                    const tpl = TEMPLATE_MAP.get(c.params?.template);
                    return (
                      <div key={c.id} className={`flex items-center gap-3 p-3.5 rounded-2xl border border-border bg-card transition-opacity ${c.is_active ? '' : 'opacity-60'}`}>
                        <span className={`shrink-0 inline-flex w-10 h-10 items-center justify-center rounded-xl ${KIND_META[c.kind]?.accent || ''}`}>
                          <Icon name={tpl?.icon || KIND_META[c.kind]?.icon || 'Settings'} className="w-5 h-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground truncate">{c.name}</span>
                            <KindBadge kind={c.kind} />
                            {tpl && <span className="text-xs text-muted-foreground">{tpl.title}</span>}
                          </div>
                          <p className="text-sm text-muted-foreground truncate mt-0.5">{summarize(c, ctx)}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Switch checked={c.is_active} onCheckedChange={v => toggleActive(c, v)} aria-label="Активен" />
                          <button onClick={() => startEdit(c)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary" title="Изменить">
                            <Icon name="Pencil" className="w-4 h-4" />
                          </button>
                          {confirmDelete === c.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => remove(c.id)} className="px-2 py-1 rounded-md bg-red-600 text-white text-xs font-medium">Удалить</button>
                              <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded-md bg-secondary text-xs">Нет</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDelete(c.id)} className="p-2 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50" title="Удалить">
                              <Icon name="Trash2" className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {view === 'name' && (
            <div className="max-w-md mx-auto py-6">
              <label className="block text-sm font-medium text-foreground mb-2">Название конфигуратора</label>
              <input autoFocus value={draft.name} onChange={e => { setDraft({ ...draft, name: e.target.value }); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && draft.name.trim()) setView('kind'); }}
                placeholder="Например: «После ночи — отдых»"
                className="w-full h-12 bg-secondary border border-border rounded-xl px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              <p className="text-xs text-muted-foreground mt-2">Название увидят в настройках сотрудника при назначении.</p>
            </div>
          )}

          {view === 'kind' && (
            <div className="grid sm:grid-cols-3 gap-3 py-2">
              {KINDS.map(k => {
                const meta = KIND_META[k];
                const active = draft.kind === k;
                return (
                  <button key={k} onClick={() => pickKind(k)}
                    className={`text-left p-5 rounded-2xl border-2 transition-all hover:-translate-y-0.5 hover:shadow-md ${active ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
                    <span className={`inline-flex w-12 h-12 items-center justify-center rounded-2xl mb-3 ${meta.accent}`}>
                      <Icon name={meta.icon} className="w-6 h-6" />
                    </span>
                    <p className="font-semibold text-foreground text-lg">{meta.label}</p>
                    <p className="text-sm text-muted-foreground mt-1 leading-snug">{meta.description}</p>
                    <p className="text-xs text-muted-foreground mt-3">{templatesOf(k).length} шаблонов</p>
                  </button>
                );
              })}
            </div>
          )}

          {view === 'edit' && draft.kind && (
            <div className="grid md:grid-cols-[260px_1fr] gap-5">
              <div className="space-y-1.5 md:max-h-[52vh] md:overflow-y-auto md:pr-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <KindBadge kind={draft.kind} /> шаблоны
                </p>
                {templatesOf(draft.kind).map(t => (
                  <button key={t.id} onClick={() => pickTemplate(t)}
                    className={`w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl transition-all ${draft.params?.template === t.id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-secondary'}`}>
                    <Icon name={t.icon} className={`w-4 h-4 mt-0.5 shrink-0 ${draft.params?.template === t.id ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-sm font-medium text-foreground leading-tight">{t.title}</span>
                  </button>
                ))}
              </div>
              <div className="space-y-5">
                {template && draft.params ? (
                  <>
                    <div className="rounded-2xl bg-secondary/60 p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon name={template.icon} className="w-5 h-5 text-primary" />
                        <p className="font-semibold text-foreground">{template.title}</p>
                      </div>
                      <p className="text-sm text-muted-foreground">{template.description}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Название</label>
                      <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                        className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <ConfiguratorParamFields template={template} params={draft.params} employees={employees}
                      onChange={p => setDraft({ ...draft, params: p })} />
                    {draft.kind === 'mode' && <ModePreview params={draft.params} />}
                    <div className="rounded-xl border border-border px-4 py-3 flex items-start gap-2">
                      <Icon name="Sparkles" className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-foreground">{summarize({ params: draft.params }, ctx)}</p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Выберите шаблон слева</p>
                )}
              </div>
            </div>
          )}
        </div>

        {view !== 'list' && (
          <div className="border-t border-border px-6 py-4 flex items-center justify-between gap-3">
            <button
              onClick={() => {
                if (draft.id || view === 'name') { setView('list'); setDraft(EMPTY_DRAFT); }
                else setView(view === 'edit' ? 'kind' : 'name');
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-border">
              <Icon name={draft.id || view === 'name' ? 'X' : 'ArrowLeft'} className="w-4 h-4" />
              {draft.id || view === 'name' ? 'Отмена' : 'Назад'}
            </button>
            <div className="flex items-center gap-3">
              {error && <span className="text-sm text-red-600 flex items-center gap-1"><Icon name="CircleAlert" className="w-4 h-4" />{error}</span>}
              {view === 'name' && (
                <button disabled={!draft.name.trim()} onClick={() => setView('kind')}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                  Далее <Icon name="ArrowRight" className="w-4 h-4" />
                </button>
              )}
              {view === 'edit' && (
                <button disabled={saving || !template} onClick={save}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  <Icon name={saving ? 'Loader2' : 'Check'} className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
