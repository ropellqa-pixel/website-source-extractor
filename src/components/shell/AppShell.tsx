import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import SideNav from './SideNav';
import BottomNav from './BottomNav';
import { useChatNotifications } from '@/hooks/useChatNotifications';

interface Notice {
  text: string;
  link?: { label: string; to: string };
}

export default function AppShell({ children, notice }: { children: ReactNode; notice?: Notice }) {
  const [open, setOpen] = useState(false);
  const n: Notice = notice || {
    text: 'Зарплата за сентябрь рассчитана по табелю.',
    link: { label: 'Проверить ›', to: '/salary' },
  };

  useChatNotifications();

  return (
    <div className="app-grid">
      <aside className="hidden border-r border-border bg-nav lg:block app-side">
        <SideNav />
      </aside>

      <header className="relative flex items-center justify-center gap-1 border-b border-border bg-card px-14 pt-[env(safe-area-inset-top)] text-center text-[13px] sm:text-[14.3px] tracking-[-0.01em] lg:border-b-0 lg:px-6 app-head">
        <button
          className="absolute bottom-2 left-2 rounded-full p-2.5 text-foreground hover:bg-secondary lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="Открыть меню"
        >
          <Icon name="Menu" size={20} />
        </button>
        <span className="truncate">
          {n.text}
          {n.link && (
            <Link to={n.link.to} className="ml-1.5 text-link hover:underline">
              {n.link.label}
            </Link>
          )}
        </span>
      </header>

      <main className="min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain app-main">{children}</main>

      <BottomNav onMore={() => setOpen(true)} />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[280px] max-w-[85vw] bg-nav p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
          <SheetTitle className="sr-only">Разделы</SheetTitle>
          <SideNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}