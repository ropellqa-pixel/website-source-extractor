import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { db } from '@/lib/sdk';

const STATS = [
  { table: 'documents', label: 'Документов', icon: 'FileText', to: '/documents' },
  { table: 'base_files', label: 'Файлов в базе', icon: 'Database', to: '/base' },
  { table: 'chat_messages', label: 'Сообщений', icon: 'MessageSquare', to: '/chat' },
  { table: 'profiles', label: 'Сотрудников', icon: 'Users', to: '/employees' },
];

export default function StatsRow({ canSeeEmployees }: { canSeeEmployees: boolean }) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    Promise.all(STATS.map(s => db.from(s.table).select('id'))).then(res => {
      const next: Record<string, number> = {};
      res.forEach((r, i) => { next[STATS[i].table] = r.data?.length || 0; });
      setCounts(next);
    });
  }, []);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {STATS.map((s, i) => {
        const disabled = s.table === 'profiles' && !canSeeEmployees;
        const body = (
          <>
            <span className="icon-tile h-10 w-10"><Icon name={s.icon} size={18} strokeWidth={1.7} /></span>
            <p className="mt-5 font-head text-[26px] font-medium tabular-nums tracking-[-0.03em]">{counts[s.table] ?? '—'}</p>
            <p className="text-[13px] text-muted-foreground">{s.label}</p>
          </>
        );
        const cls = 'reveal-up surface block p-5 text-left';
        return disabled ? (
          <div key={s.table} className={cls} style={{ animationDelay: `${0.5 + i * 0.07}s` }}>{body}</div>
        ) : (
          <Link key={s.table} to={s.to} className={`${cls} surface-hover`} style={{ animationDelay: `${0.5 + i * 0.07}s` }}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
