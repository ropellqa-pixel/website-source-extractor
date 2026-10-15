import { useEffect, useState } from 'react';
import { sberCall } from '@/lib/sberApi';
import SberTab from './SberTab';
import SberProductPanel, { type SberProduct } from './SberProductPanel';

export default function SberSection() {
  const [sub, setSub] = useState('b2bsaas');
  const [ver, setVer] = useState(0);
  const [list, setList] = useState<SberProduct[]>([]);

  useEffect(() => {
    sberCall<{ products: SberProduct[] }>({ action: 'products' }).then((r) => { if (!r.error) setList(r.products); });
  }, []);

  const current = list.find((p) => p.code === sub);
  const tabs = list.map((p) => ({ code: p.code, label: p.app.split('_')[1] || p.app, hint: p.main ? `${p.title} · основная` : p.title, active: p.active }));
  const saved = (l: SberProduct[]) => { setList(l); setVer((v) => v + 1); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.code} onClick={() => setSub(t.code)}
            className={`rounded-xl border px-3 py-2 text-left ${sub === t.code ? 'border-emerald-600 bg-emerald-600/5' : 'bg-card hover:bg-secondary'}`}>
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <span className={`h-2 w-2 rounded-full ${t.active ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />{t.label}
            </div>
            <div className="text-xs text-muted-foreground">{t.hint}</div>
          </button>
        ))}
      </div>
      {current && <SberProductPanel key={current.code} p={current} onSaved={saved} />}
      {current?.main && <SberTab key={ver} />}
    </div>
  );
}
