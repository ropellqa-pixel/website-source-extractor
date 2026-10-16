import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { skudCall } from '@/lib/skudApi';

interface Notice { id: string; card_id: string; cycle: string; text: string; grace: boolean; days: number }

export default function SkudNotices() {
  const [items, setItems] = useState<Notice[]>([]);

  const load = useCallback(async () => {
    const r = await skudCall<{ notices: Notice[] }>({ action: 'notices' });
    if (!r.error) setItems(r.notices || []);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const close = (n: Notice) => {
    setItems((list) => list.filter((x) => x.id !== n.id));
    skudCall({ action: 'notice_dismiss', card_id: n.card_id, cycle: n.cycle });
  };

  if (items.length === 0) return null;
  return (
    <div className="space-y-2 px-3 pt-3 sm:px-4 md:px-6">
      {items.map((n) => (
        <div key={n.id} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${n.grace ? 'border-red-500/40 bg-red-500/10 text-red-800' : 'border-amber-500/40 bg-amber-500/10 text-amber-900'}`}>
          <Icon name="TriangleAlert" size={17} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="break-words font-medium">{n.text}</div>
            <Link to="/skud?cards=1" className="text-xs underline">Перезаписать карту в СКУД ›</Link>
          </div>
          <button onClick={() => close(n)} aria-label="Закрыть" className="rounded p-1 hover:bg-black/5"><Icon name="X" size={16} /></button>
        </div>
      ))}
    </div>
  );
}
