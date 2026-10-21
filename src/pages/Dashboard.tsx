import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/lib/auth';
import { useAccess } from '@/lib/access';
import { ROLE_LABELS, visibleNav } from '@/lib/navigation';
import StatsRow from '@/components/dashboard/StatsRow';
import PlanCalendar from '@/components/dashboard/PlanCalendar';

export default function Dashboard() {
  const { user, company } = useAuth();
  const { access } = useAccess();
  const isDirectorOrDeputy = user?.role === 'director' || user?.role === 'deputy_director';
  const sections = visibleNav(user?.role, access?.sections).filter(i => i.path !== '/dashboard');
  const firstName = (user?.fullName || '').split(' ')[1] || user?.fullName?.split(' ')[0] || '';

  return (
    <div className="flex flex-col items-center px-5 pb-20 text-center">
      <PlanCalendar />

      <section className="mt-16 w-full max-w-[980px] text-left">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[13px] text-muted-foreground">
              {company?.name || user?.companyName || 'АнодБИЗ'} · {ROLE_LABELS[user?.role || 'employee']}
            </p>
            <h2 className="font-head text-[26px] font-medium tracking-[-0.03em]">
              {firstName ? `Здравствуйте, ${firstName}` : 'Сводка'}
            </h2>
          </div>
        </div>
        <StatsRow canSeeEmployees={isDirectorOrDeputy} />

        <h3 className="mb-4 mt-14 text-[13px] uppercase tracking-[0.08em] text-muted-foreground">Разделы</h3>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
          {sections.map(s => (
            <Link
              key={s.path}
              to={s.path}
              className="group flex items-center justify-between gap-3 bg-card px-5 py-5 text-[15px] transition-colors hover:bg-nav"
            >
              <span className="flex items-center gap-3">
                <Icon name={s.icon} size={18} strokeWidth={1.5} className="text-muted-foreground" />
                {s.label}
              </span>
              <Icon name="ChevronRight" size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}