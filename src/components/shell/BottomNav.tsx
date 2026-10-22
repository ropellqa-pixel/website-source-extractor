import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/lib/auth';
import { useAccess } from '@/lib/access';
import { visibleNav } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { getUnreadCount, subscribeUnread } from '@/lib/chatUnread';

const PRIORITY = ['/dashboard', '/chat', '/schedule', '/sber', '/salary', '/documents', '/collection'];

export default function BottomNav({ onMore }: { onMore: () => void }) {
  const { user } = useAuth();
  const { access } = useAccess();
  const { pathname } = useLocation();
  const [unread, setUnread] = useState(0);
  const all = visibleNav(user?.role, access?.sections);
  const main = PRIORITY.map((p) => all.find((i) => i.path === p)).filter(Boolean).slice(0, 4) as typeof all;
  const moreActive = !main.some((i) => pathname.startsWith(i.path));

  useEffect(() => {
    setUnread(getUnreadCount());
    return subscribeUnread(setUnread);
  }, []);

  const cell = 'relative flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] leading-none transition-colors active:scale-95';
  const pill = (on: boolean) => cn('grid h-7 w-12 place-items-center rounded-full transition-all duration-200', on ? 'bg-[hsl(var(--slab))] text-[hsl(var(--day))]' : '');

  return (
    <nav className="frost app-tabs flex border-t border-border/70 lg:hidden" aria-label="Быстрые разделы">
      {main.map((i) => (
        <NavLink key={i.path} to={i.path}
          className={({ isActive }) => cn(cell, isActive ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
          {({ isActive }) => (<>
          <span className={pill(isActive)}><Icon name={i.icon} size={20} strokeWidth={isActive ? 2 : 1.7} /></span>
          <span className="max-w-full truncate px-1">{i.label}</span>
          {i.path === '/chat' && unread > 0 && (
            <span className="absolute left-1/2 top-1 ml-2.5 flex ring-2 ring-white h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
          </>)}
        </NavLink>
      ))}
      <button onClick={onMore} className={cn(cell, moreActive ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
        <span className={pill(moreActive)}><Icon name="LayoutGrid" size={20} strokeWidth={moreActive ? 2 : 1.7} /></span>
        <span>Ещё</span>
      </button>
    </nav>
  );
}
