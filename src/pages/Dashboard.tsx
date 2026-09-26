import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS, visibleNav } from '@/lib/navigation';
import MonthSlab, { monthInfo } from '@/components/dashboard/MonthSlab';
import StatsRow from '@/components/dashboard/StatsRow';

const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export default function Dashboard() {
  const { user, company } = useAuth();
  const today = new Date();
  const { workdays, m } = monthInfo(today);
  const isDirectorOrDeputy = user?.role === 'director' || user?.role === 'deputy_director';
  const sections = visibleNav(user?.role).filter(i => i.path !== '/dashboard');
  const firstName = (user?.fullName || '').split(' ')[1] || user?.fullName?.split(' ')[0] || '';

  return (
    <div className="flex flex-col items-center px-5 pb-20 text-center">
      <section className="flex w-full flex-col items-center pt-14">
        <p className="reveal-up text-[26px] font-medium leading-[1.1] tracking-[-0.02em]" style={{ animationDelay: '.05s' }}>
          Табель
        </p>
        <h1
          className="reveal-up mt-1 font-head text-[40px] font-extrabold leading-[1.08] tracking-[-0.045em] sm:text-[52px] lg:text-[64px]"
          style={{ animationDelay: '.15s' }}
        >
          {MONTHS_NOM[m]} закрыт.
        </h1>
        <Link
          to="/schedule"
          className="reveal-up mt-6 inline-flex h-11 items-center rounded-full bg-primary px-[22px] text-[17px] text-primary-foreground transition-opacity hover:opacity-85"
          style={{ animationDelay: '.3s' }}
        >
          Открыть табель
        </Link>
        <p className="reveal-up mt-4 text-[17px] font-semibold tracking-[-0.01em]" style={{ animationDelay: '.38s' }}>
          {workdays} смен из {workdays}
        </p>

        <div className="reveal-rise mt-[90px] flex w-full justify-center" style={{ animationDelay: '.45s' }}>
          <MonthSlab date={today} />
        </div>
      </section>

      <section className="mt-24 w-full max-w-[980px] text-left">
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
