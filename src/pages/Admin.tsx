import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import PositionsTab from '@/components/admin/PositionsTab';
import FormulasTab from '@/components/admin/FormulasTab';
import FieldsTab from '@/components/admin/FieldsTab';
import DirectoriesTab from '@/components/admin/DirectoriesTab';
import type { AdminData } from '@/components/admin/types';
import { adminCall, useAccess } from '@/lib/access';

type Tab = 'positions' | 'formulas' | 'fields' | 'dirs';
const TABS: [Tab, string, string][] = [
  ['positions', 'Должности и доступ', 'ShieldCheck'],
  ['formulas', 'Формулы зарплаты', 'Calculator'],
  ['fields', 'Поля форм', 'Columns3'],
  ['dirs', 'Справочники', 'BookOpen'],
];

export default function Admin() {
  const [tab, setTab] = useState<Tab>('positions');
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { reload } = useAccess();

  const load = useCallback(async () => {
    const r = await adminCall<AdminData>({ action: 'overview' });
    if (r.error) setError(r.error); else setData(r);
  }, []);

  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); reload(); };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Админ-панель</h1>
        <p className="text-sm text-muted-foreground">Должности, доступ к разделам и кнопкам, формулы, колонки таблиц и справочники</p>
      </div>
      <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-0.5 w-fit">
        {TABS.map(([k, l, i]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <Icon name={i} fallback="Circle" size={15} />{l}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data ? (
        !error && <div className="flex justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {tab === 'positions' && <PositionsTab data={data} onChanged={changed} />}
          {tab === 'formulas' && <FormulasTab key={JSON.stringify(data.formulas)} data={data} onChanged={changed} />}
          {tab === 'fields' && <FieldsTab data={data} onChanged={changed} />}
          {tab === 'dirs' && <DirectoriesTab data={data} onChanged={changed} />}
        </>
      )}
    </div>
  );
}
