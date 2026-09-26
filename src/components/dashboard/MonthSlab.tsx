const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function monthInfo(date: Date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  let workdays = 0;
  for (let d = 1; d <= days; d++) {
    const wd = (offset + d - 1) % 7;
    if (wd < 5) workdays++;
  }
  return { y, m, days, offset, workdays, title: `${MONTHS[m]} ${y}` };
}

export default function MonthSlab({ date, className = '' }: { date: Date; className?: string }) {
  const { days, offset, workdays, title } = monthInfo(date);
  const cells: { d: number | null; weekend: boolean }[] = [];
  for (let i = 0; i < offset; i++) cells.push({ d: null, weekend: false });
  for (let d = 1; d <= days; d++) cells.push({ d, weekend: (offset + d - 1) % 7 >= 5 });
  while (cells.length % 7) cells.push({ d: null, weekend: false });

  return (
    <div className={`slab w-full max-w-[540px] px-[30px] py-[26px] text-left ${className}`} aria-hidden="true">
      <div className="mb-[18px] flex items-baseline justify-between text-slab-day">
        <b className="font-head text-[16px] font-medium tracking-[-0.02em]">{title}</b>
        <span className="text-[12px] opacity-75">{workdays * 8} часов</span>
      </div>
      <div className="mb-2 grid grid-cols-7 gap-2">
        {WEEKDAYS.map(w => (
          <i key={w} className="text-center text-[10.5px] not-italic uppercase tracking-[0.06em] text-slab-day opacity-60">{w}</i>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {cells.map((c, i) => (
          <i
            key={i}
            className={
              'grid h-[46px] place-items-center rounded-xl text-[12px] font-medium not-italic transition-transform ' +
              (c.d === null
                ? 'bg-transparent'
                : c.weekend
                  ? 'bg-transparent text-slab-day opacity-50'
                  : 'bg-card text-foreground shadow-[0_1px_2px_hsl(var(--day)/0.15)] hover:-translate-y-0.5')
            }
          >
            {c.d ?? ''}
          </i>
        ))}
      </div>
    </div>
  );
}
