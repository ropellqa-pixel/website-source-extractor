import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import SideNav from './SideNav';
import BottomNav from './BottomNav';
import SkudNotices from './SkudNotices';
import { useChatNotifications } from '@/hooks/useChatNotifications';
import { NAV_ITEMS } from '@/lib/navigation';
import { useAuth } from '@/lib/auth';

interface Notice {
  text: string;
  link?: { label: string; to: string };
}

export default function AppShell({ children, notice }: { children: ReactNode; notice?: Notice }) {
  const [open, setOpen] = useState(false);
  const n: Notice = notice || { text: '' };
  const { pathname } = useLocation();
  const { user, company } = useAuth();
  const page = NAV_ITEMS.find((i) => pathname === i.path || pathname.startsWith(`${i.path}/`));
  const fallback = page?.label || company?.name || user?.companyName || 'АнодБИЗ';
  const hasNotice = Boolean(n.text || n.link);

  useChatNotifications();

  return (
    <div className="app-grid">
      <aside className="hidden border-r border-border/70 bg-nav/80 backdrop-blur-xl lg:block app-side">
        <SideNav />
      </aside>

      <header className="frost relative z-10 flex items-center justify-center gap-1 border-b border-border/70 px-14 pt-[env(safe-area-inset-top)] text-center text-[13px] tracking-[-0.01em] sm:text-[14.3px] lg:justify-start lg:px-8 lg:text-left app-head">
        <button
          className="absolute bottom-2 left-2 rounded-xl p-2.5 text-foreground transition-colors hover:bg-secondary active:scale-95 lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="Открыть меню"
        >
          <Icon name="Menu" size={20} />
        </button>
        {hasNotice ? (
          <span className="truncate">
            {n.text}
            {n.link && (
              <Link to={n.link.to} className="ml-1.5 font-medium text-link hover:underline">
                {n.link.label}
              </Link>
            )}
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-2 truncate font-medium text-foreground/80">
            {page && <Icon name={page.icon} size={16} strokeWidth={1.7} className="hidden shrink-0 text-[hsl(var(--day))] lg:block" />}
            <span className="truncate">{fallback}</span>
          </span>
        )}
      </header>

      <main className="min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain app-main"><SkudNotices />{children}</main>

      <BottomNav onMore={() => setOpen(true)} />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[280px] max-w-[85vw] rounded-r-3xl border-r-0 bg-nav p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
          <SheetTitle className="sr-only">Разделы</SheetTitle>
          <SideNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}