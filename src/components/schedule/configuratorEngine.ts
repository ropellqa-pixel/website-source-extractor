import type { SolverHooks } from '@/lib/scheduleSolver';
import {
  ConfigParams,
  ConfiguratorRecord,
  TEMPLATE_MAP,
  absDay,
  defaultParams,
  getArr,
  getNum,
  getStr,
  modeDayRule,
  parseCycle,
  parseDayList,
  weekdayOf,
} from './configuratorCatalog';

export interface EngineEmployee {
  profile_id: string;
  full_name?: string;
  configurator_ids?: string[];
}

export interface EngineViolation {
  profile_id: string;
  day: number;
  rule: string;
}

export interface ConfiguratorEngine {
  hooks: SolverHooks;
  notify: boolean;
  findViolations: (rows: string[][]) => EngineViolation[];
}

const HARD = 1000;
const MODE_OFF = 400;
const MODE_CODE = 150;
const SOFT = 25;

const isDayCode = (s: string) => s === 'Д' || s === 'Дп';
const isNightCode = (s: string) => s === 'Н' || s === 'Нп';
const matches = (code: string, s: string) => (code === '*' ? s !== '' : code === s);
const startHour = (s: string) => (isNightCode(s) ? 20 : 8);

interface Compiled {
  name: string;
  p: ConfigParams;
  seq?: string[];
  days?: Set<number>;
}

interface Pair {
  a: number;
  b: number;
  kind: 'not' | 'only';
  shift: boolean;
  name: string;
}

function compile(rec: ConfiguratorRecord): Compiled | null {
  const tpl = TEMPLATE_MAP.get(rec.params?.template);
  if (!tpl) return null;
  const p: ConfigParams = { ...defaultParams(tpl), ...rec.params };
  const c: Compiled = { name: rec.name || tpl.title, p };
  if (p.template === 'forbid_sequence') c.seq = parseCycle(getStr(p, 'pattern'));
  if (p.template === 'required_sequence') c.seq = parseCycle(getStr(p, 'then'));
  if (p.template === 'fixed_days') c.days = new Set(parseDayList(getStr(p, 'days')));
  return c;
}

export function buildConfiguratorEngine(
  emps: EngineEmployee[],
  configurators: ConfiguratorRecord[],
  year: number,
  month: number,
  days: number,
): ConfiguratorEngine | null {
  const byId = new Map(configurators.filter(c => c.is_active !== false).map(c => [c.id, c]));
  const idx = new Map(emps.map((e, i) => [e.profile_id, i]));
  const per: Compiled[][] = emps.map(e =>
    (e.configurator_ids || []).map(id => byId.get(id)).filter((r): r is ConfiguratorRecord => !!r).map(compile).filter((c): c is Compiled => !!c),
  );
  if (!per.some(l => l.length)) return null;

  const weekday = Array.from({ length: days }, (_, d) => weekdayOf(year, month, d));
  const abs = Array.from({ length: days }, (_, d) => absDay(year, month, d));
  const weekNo = abs.map(a => Math.floor((a + 3) / 7));

  const modes = per.map(l => l.filter(c => c.p.template.startsWith('mode_')));
  const autoSub = per.map(l => l.some(c => c.p.template === 'auto_mark_sub'));
  const evenNightGroup = per.map((l, i) => (l.some(c => c.p.template === 'even_nights') ? i : -1)).filter(i => i >= 0);
  const evenWeight = per.map(l => {
    const c = l.find(x => x.p.template === 'even_nights');
    return c ? ({ low: 4, medium: 10, high: 25 } as Record<string, number>)[getStr(c.p, 'weight')] ?? 10 : 0;
  });

  const equalAll = per.flat().find(c => c.p.template === 'equal_all');

  const pairs: Pair[] = [];
  per.forEach((l, a) => l.forEach(c => {
    if (c.p.template !== 'not_with' && c.p.template !== 'only_with') return;
    const b = idx.get(getStr(c.p, 'employee'));
    if (b === undefined || b === a) return;
    pairs.push({ a, b, kind: c.p.template === 'not_with' ? 'not' : 'only', shift: getStr(c.p, 'scope') === 'shift', name: c.name });
  }));

  const worked = (row: string[], d: number) => {
    let n = 0;
    for (let i = 0; i < d; i++) if (row[i]) n++;
    return n;
  };

  const nightMeanCache = new WeakMap<string[][], number>();
  const nightMean = (rows: string[][], d: number) => {
    const hit = nightMeanCache.get(rows);
    if (hit !== undefined) return hit;
    let sum = 0;
    for (const i of evenNightGroup) for (let k = 0; k < d; k++) if (isNightCode(rows[i][k])) sum++;
    const m = evenNightGroup.length ? sum / evenNightGroup.length : 0;
    nightMeanCache.set(rows, m);
    return m;
  };

  const modeCost = (p: number, s: string, d: number): number => {
    let c = 0;
    for (const m of modes[p]) {
      const t = m.p.template;
      if (t === 'mode_floating') {
        if (getArr<number>(m.p, 'free').includes(weekday[d])) c += SOFT;
        continue;
      }
      if (t === 'mode_part_time') continue;
      const r = modeDayRule(m.p, abs[d], weekday[d]);
      if (!r) continue;
      if (r.allow && !r.allow.includes(s)) c += HARD;
      if (r.off) {
        if (autoSub[p]) c += s === 'Дп' || s === 'Нп' ? SOFT : MODE_OFF;
        else c += MODE_OFF;
      }
      if (r.must && r.must !== s) {
        const sameHalf = isDayCode(r.must) === isDayCode(s);
        c += sameHalf ? MODE_CODE / 3 : MODE_CODE;
      }
    }
    return c;
  };

  const check = (p: number, s: string, d: number, rows: string[][], out?: string[]): number => {
    const row = rows[p];
    const prev = d > 0 ? row[d - 1] : null;
    let cost = 0;
    const hit = (v: number, name: string) => { cost += v; if (out && v >= HARD) out.push(name); };
    for (const c of per[p]) {
      const q = c.p;
      switch (q.template) {
        case 'after_x_y': {
          if (prev === null || !matches(getStr(q, 'from'), prev)) break;
          const to = getStr(q, 'to');
          if (getStr(q, 'rule') === 'forbid') { if (to === s) hit(HARD, c.name); }
          else if (to !== s) hit(HARD, c.name);
          break;
        }
        case 'forbid_sequence': {
          const seq = c.seq || [];
          if (seq.length < 1 || d < seq.length - 1) break;
          let ok = true;
          for (let k = 0; k < seq.length - 1 && ok; k++) if (row[d - (seq.length - 1) + k] !== seq[k]) ok = false;
          if (ok && seq[seq.length - 1] === s) hit(HARD, c.name);
          break;
        }
        case 'required_sequence': {
          const seq = c.seq || [];
          const from = getStr(q, 'from');
          for (let k = 1; k <= seq.length && d - k >= 0; k++) {
            if (row[d - k] === from) { if (seq[k - 1] !== s) hit(HARD, c.name); break; }
          }
          break;
        }
        case 'max_consecutive': {
          const code = getStr(q, 'code', '*');
          if (!matches(code, s)) break;
          let run = 0;
          for (let k = d - 1; k >= 0 && matches(code, row[k]); k--) run++;
          if (run + 1 > getNum(q, 'n', 3)) hit(HARD, c.name);
          break;
        }
        case 'min_rest_after': {
          if (!s) break;
          let k = d - 1;
          let rest = 0;
          while (k >= 0 && !row[k]) { rest++; k--; }
          let run = 0;
          while (k >= 0 && row[k]) { run++; k--; }
          const n = getNum(q, 'n', 2);
          if (rest === 0 && run >= n) hit(HARD, c.name);
          else if (rest > 0 && rest < getNum(q, 'rest', 2) && run >= n) hit(HARD, c.name);
          break;
        }
        case 'max_per_week':
        case 'mode_part_time': {
          const code = q.template === 'mode_part_time' ? '*' : getStr(q, 'code', '*');
          if (!matches(code, s)) break;
          let n = 0;
          for (let k = d - 1; k >= 0 && weekNo[k] === weekNo[d]; k--) if (matches(code, row[k])) n++;
          if (n + 1 > getNum(q, 'n', 4)) hit(HARD, c.name);
          break;
        }
        case 'max_per_month':
          if (s && worked(row, d) + 1 > getNum(q, 'n', 15)) hit(HARD, c.name);
          break;
        case 'mode_floating':
          if (s && worked(row, d) + 1 > getNum(q, 'shifts', 12)) hit(HARD / 2, c.name);
          break;
        case 'weekday_ban': {
          const codes = getArr<string>(q, 'codes');
          if (s && getArr<number>(q, 'weekdays').map(Number).includes(weekday[d]) && (!codes.length || codes.includes(s))) hit(HARD, c.name);
          break;
        }
        case 'weekend_only': {
          if (!s) break;
          const we = weekday[d] >= 6;
          if (getStr(q, 'scope') === 'weekdays' ? we : !we) hit(HARD, c.name);
          break;
        }
        case 'min_rest_hours': {
          if (!s) break;
          const need = getNum(q, 'hours', 24);
          const dur = (x: string) => (isNightCode(x) ? getNum(q, 'night_hours', 12) : getNum(q, 'day_hours', 12));
          for (let k = d - 1; k >= 0 && k >= d - 5; k--) {
            if (!row[k]) continue;
            const end = k * 24 + startHour(row[k]) + dur(row[k]);
            if (d * 24 + startHour(s) - end < need) hit(HARD, c.name);
            break;
          }
          break;
        }
        case 'weekend_priority':
          if (s && getArr<number>(q, 'weekdays').map(Number).includes(weekday[d])) hit(SOFT, c.name);
          break;
        case 'balance_hours': {
          const sh = getNum(q, 'shift_hours', 12);
          if (s && (worked(row, d) + 1) * sh > getNum(q, 'norm', 168)) hit(200, c.name);
          break;
        }
        case 'overtime_cap': {
          const sh = getNum(q, 'shift_hours', 12);
          if (s && (worked(row, d) + 1) * sh > getNum(q, 'max_hours', 192)) hit(HARD, c.name);
          break;
        }
        case 'fixed_days': {
          if (!c.days?.has(d + 1)) break;
          if (getStr(q, 'code') !== s) hit(HARD, c.name);
          break;
        }
        case 'alternate_weeks': {
          if (!s) break;
          const evenDay = getStr(q, 'start') !== 'night';
          const wantDay = weekNo[d] % 2 === 0 ? evenDay : !evenDay;
          if (wantDay !== isDayCode(s)) hit(150, c.name);
          break;
        }
        case 'even_nights':
          if (isNightCode(s)) {
            let mine = 0;
            for (let k = 0; k < d; k++) if (isNightCode(row[k])) mine++;
            hit((mine - nightMean(rows, d)) * evenWeight[p], c.name);
          }
          break;
        default:
          break;
      }
    }
    if (s) {
      const m = modeCost(p, s, d);
      if (out && m >= MODE_OFF) out.push(modes[p][0]?.name || 'Режим');
      cost += m;
    } else {
      for (const m of modes[p]) {
        const r = modeDayRule(m.p, abs[d], weekday[d]);
        if (r?.must) { cost += MODE_OFF; if (out) out.push(m.name); }
      }
    }
    return cost;
  };

  const skipExtra = (p: number, d: number, rows: string[][]): number => {
    let c = check(p, '', d, rows);
    const row = rows[p];
    const remaining = days - d - 1;
    for (const x of per[p]) {
      const t = x.p.template;
      let target = -1;
      if (t === 'min_per_month') target = getNum(x.p, 'n', 10);
      else if (t === 'mode_floating') target = getNum(x.p, 'shifts', 12);
      else if (t === 'balance_hours') target = Math.ceil(getNum(x.p, 'norm', 168) / Math.max(1, getNum(x.p, 'shift_hours', 12)));
      if (target < 0) continue;
      const need = target - worked(row, d);
      if (need <= 0) continue;
      c += need > remaining ? 300 : (need / (remaining + 1)) * 40;
    }
    return c;
  };

  const pairSlotHalf = (pick: number[], who: number) => {
    const k = pick.indexOf(who);
    return k < 0 ? -1 : k % 2;
  };

  const comboCost = pairs.length
    ? (pick: number[]) => {
      let c = 0;
      for (const pr of pairs) {
        const ha = pairSlotHalf(pick, pr.a);
        if (ha < 0) continue;
        const hb = pairSlotHalf(pick, pr.b);
        const together = hb >= 0 && (!pr.shift || ha === hb);
        if (pr.kind === 'not' ? together : !together) c += HARD;
      }
      return c;
    }
    : undefined;

  const findViolations = (rows: string[][]): EngineViolation[] => {
    const out: EngineViolation[] = [];
    for (let p = 0; p < emps.length; p++) {
      if (!per[p].length) continue;
      for (let d = 0; d < days; d++) {
        const names: string[] = [];
        check(p, rows[p]?.[d] || '', d, rows, names);
        for (const n of new Set(names)) out.push({ profile_id: emps[p].profile_id, day: d + 1, rule: n });
      }
    }
    for (let d = 0; d < days; d++) {
      for (const pr of pairs) {
        const sa = rows[pr.a]?.[d] || '';
        if (!sa) continue;
        const sb = rows[pr.b]?.[d] || '';
        const together = !!sb && (!pr.shift || isDayCode(sa) === isDayCode(sb));
        if (pr.kind === 'not' ? together : !together) out.push({ profile_id: emps[pr.a].profile_id, day: d + 1, rule: pr.name });
      }
    }
    return out;
  };

  return {
    hooks: {
      slotCost: (p, s, d, rows) => (per[p].length ? check(p, s, d, rows) : 0),
      skipCost: (p, d, rows) => (per[p].length ? skipExtra(p, d, rows) : 0),
      comboCost,
      balanceAll: !!equalAll,
      balanceWeight: equalAll ? ({ medium: 2, high: 4, max: 8 } as Record<string, number>)[getStr(equalAll.p, 'weight')] ?? 4 : 1,
    },
    notify: per.some(l => l.some(c => c.p.template === 'notify_deputy')),
    findViolations,
  };
}
