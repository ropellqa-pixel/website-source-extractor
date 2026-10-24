import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import AnodBizLogo from '@/components/AnodBizLogo';
import { useAuth } from '@/lib/auth';
import { useAccess } from '@/lib/access';
import { ROLE_LABELS, initials, shortName, visibleNav } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { getUnreadCount, subscribeUnread } from '@/lib/chatUnread';
import { useLicenseState } from '@/lib/license';

export default function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const { access } = useAccess();
  const navigate = useNavigate();
  const { isBizAdmin } = useLicenseState();
  const baseItems = visibleNav(user?.role, access?.sections);
  const items = isBizAdmin ? [...baseItems, { label: 'Админка БИЗ', path: '/biz-admin', icon: 'ShieldCheck', group: 3 }] : baseItems;
  const name = user?.fullName || user?.email || '';
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setUnread(getUnreadCount());
    return subscribeUnread(setUnread);
  }, []);

  const GROUPS = ['', 'Работа', 'Финансы', 'Управление'];

  return (
    <div className="flex h-full flex-col px-3.5 pb-4 pt-[18px]">
      <div className="mb-5 flex items-center gap-3 rounded-2xl px-2 py-1.5">
        <AnodBizLogo size="sm" className="drop-shadow-[0_4px_10px_hsl(222_47%_11%/0.25)]" />
        <div className="min-w-0 leading-tight">
          <span className="block text-[16px] font-semibold tracking-[-0.02em]">АнодБИЗ</span>
          <span className="block text-[11.5px] text-muted-foreground">Управление бизнесом</span>
        </div>
      </div>

      <nav className="-mx-1 flex flex-col gap-0.5 overflow-y-auto px-1 pb-2" aria-label="Разделы">
        {items.map((item, i) => {
          const sep = i > 0 && items[i - 1].group !== item.group;
          return (
            <div key={item.path}>
              {sep && (
                <div className="px-2.5 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/80">
                  {GROUPS[item.group] || ''}
                </div>
              )}
              <NavLink
                to={item.path}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-[15px] tracking-[-0.005em] transition-all duration-150 lg:py-[7px] lg:text-[13.6px]',
                    isActive
                      ? 'bg-card font-semibold text-foreground shadow-card'
                      : 'text-muted-foreground hover:bg-card/70 hover:text-foreground active:scale-[0.98]',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        'grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors',
                        isActive ? 'icon-tile' : 'text-muted-foreground group-hover:text-foreground',
                      )}
                    >
                      <Icon name={item.icon} size={16} strokeWidth={isActive ? 1.9 : 1.6} />
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.path === '/chat' && unread > 0 && (
                      <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white shadow-[0_2px_6px_-1px_rgb(239_68_68/0.5)]">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-2.5 rounded-2xl border border-border/70 bg-card p-2.5 shadow-soft">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[hsl(var(--logo-1))] to-[hsl(var(--logo-2))] text-[12px] font-semibold text-white">
          {initials(name)}
        </div>
        <p className="min-w-0 flex-1 text-[13px] leading-tight">
          <span className="block truncate font-medium">{shortName(name) || name}</span>
          <small className="block truncate text-[12px] text-muted-foreground">{ROLE_LABELS[user?.role || 'employee']}</small>
        </p>
        <button
          onClick={async () => { await signOut(); navigate('/login'); }}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 active:scale-95"
          title="Выйти"
          aria-label="Выйти"
        >
          <Icon name="LogOut" size={16} />
        </button>
      </div>
    </div>
  );
}
