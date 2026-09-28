import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import AnodBizLogo from '@/components/AnodBizLogo';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS, initials, shortName, visibleNav } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { getUnreadCount, subscribeUnread } from '@/lib/chatUnread';

export default function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const items = visibleNav(user?.role);
  const name = user?.fullName || user?.email || '';
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setUnread(getUnreadCount());
    return subscribeUnread(setUnread);
  }, []);

  return (
    <div className="flex h-full flex-col px-4 pt-[18px] pb-5">
      <div className="mb-[26px] flex h-10 items-center gap-2.5 px-2">
        <AnodBizLogo size="sm" />
        <span className="text-[17px] font-semibold tracking-[-0.01em]">АнодБИЗ</span>
      </div>

      <nav className="flex flex-col gap-0.5 overflow-y-auto" aria-label="Разделы">
        {items.map((item, i) => {
          const sep = i > 0 && items[i - 1].group !== item.group;
          return (
            <div key={item.path}>
              {sep && <div className="mx-2.5 my-2.5 h-px bg-border" />}
              <NavLink
                to={item.path}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13.6px] tracking-[-0.005em] transition-colors',
                    isActive
                      ? 'soft-shadow bg-card font-semibold text-foreground'
                      : 'text-muted-foreground hover:bg-card/70 hover:text-foreground',
                  )
                }
              >
                <Icon name={item.icon} size={17} strokeWidth={1.5} className="shrink-0" />
                <span className="flex-1">{item.label}</span>
                {item.path === '/chat' && unread > 0 && (
                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </NavLink>
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-2.5 px-2 pt-4">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-border text-[12px] font-semibold">
          {initials(name)}
        </div>
        <p className="min-w-0 flex-1 text-[13px] leading-tight">
          <span className="block truncate">{shortName(name) || name}</span>
          <small className="block text-[13px] text-muted-foreground">{ROLE_LABELS[user?.role || 'employee']}</small>
        </p>
        <button
          onClick={async () => { await signOut(); navigate('/login'); }}
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          title="Выйти"
          aria-label="Выйти"
        >
          <Icon name="LogOut" size={16} />
        </button>
      </div>
    </div>
  );
}