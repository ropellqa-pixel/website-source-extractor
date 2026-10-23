/**
 * Генератор табеля.
 * Жёстко: каждый день ровно 4 смены — Д, Н, Дп, Нп (по одному человеку на каждую),
 * один человек — не больше одной смены в день, запреты дней/ночей, недоступные даты,
 * преференции (сотрудник с преференциями работает только в паре из своего списка).
 * Правила компании (очень высокий приоритет):
 *   СТ — «Д», на следующий день «Н», затем отдых не меньше 1 дня (или перерыв из настроек).
 *   МЛ с перерывом 0 — «Дп» подряд 3–6 дней, серия заканчивается «Нп», после — 2 дня отдыха.
 *   Остальные — перерыв из настроек.
 * Равномерность: внутри СТ и внутри МЛ количество смен выравнивается.
 * Перебираются сотни вариантов, выбирается лучший.
 */
export interface SolverEmployee {
  profile_id: string;
  status: string;
  no_day: boolean;
  no_night: boolean;
  break_days: number;
  priority: number;
  delays: number[];
  unavailable: number[];
  preferences: string[];
  st_no_day: boolean;
  st_no_night: boolean;
  ml_no_day: boolean;
  ml_no_night: boolean;
}

export interface SolverHooks {
  slotCost?: (p: number, s: string, d: number, rows: string[][]) => number;
  skipCost?: (p: number, d: number, rows: string[][]) => number;
  comboCost?: (pick: number[], d: number) => number;
  balanceAll?: boolean;
  balanceWeight?: number;
  balanceExclude?: number[];
  noNightCost?: number;
}

const SLOTS = ['Д', 'Н', 'Дп', 'Нп'] as const;
const PARTNER = [2, 3, 0, 1];
const RULE = 100;
const EMPTY = 5000;
let BAL = 6;
let NO_NIGHT_COST = 5;
export function setNoNightCost(v: number) { NO_NIGHT_COST = v; }
export function setBalanceWeight(w: number) { BAL = w; }

function shiftTypes(e: SolverEmployee): string[] {
  if (e.status === 'СТ') return ['Д', 'Н'];
  if (e.status === 'МЛ') return ['Дп', 'Нп'];
  return ['Д', 'Н', 'Дп', 'Нп'];
}

function allowed(e: SolverEmployee, s: string, dayNum: number): boolean {
  if (!shiftTypes(e).includes(s)) return false;
  if ((s === 'Д' || s === 'Дп') && e.no_day) return false;
  if ((s === 'Н' || s === 'Нп') && e.no_night) return false;
  if (e.status === 'ЛБ') {
    if (s === 'Д' && e.st_no_day) return false;
    if (s === 'Н' && e.st_no_night) return false;
    if (s === 'Дп' && e.ml_no_day) return false;
    if (s === 'Нп' && e.ml_no_night) return false;
  }
  return !e.unavailable.includes(dayNum) && !e.delays.includes(dayNum);
}

const isSt = (e: SolverEmployee) => e.status === 'СТ' && !e.no_day && !e.no_night;
const isMl = (e: SolverEmployee) => e.status === 'МЛ' && !e.break_days && !e.no_day && !e.no_night;
// Группы для выравнивания количества смен: все СТ — между собой (СТ без ночей работает «Д»,
// а «Н» после неё закрывает другой СТ — так пара Д+Н сохраняется); МЛ сериями — между собой;
// МЛ с ограничениями (только ночи, свой перерыв) — отдельно.
const group = (e: SolverEmployee) => (e.status === 'СТ' ? 'СТ' : isMl(e) ? 'МЛ' : e.status === 'МЛ' ? 'МЛx' : 'ЛБ');

function compatible(adjacentAllowed: (a: string, b: string) => boolean, prev: string, next: string) {
  return adjacentAllowed(prev, next);
}

interface State {
  rows: string[][];
  last: number[];
  lastShift: string[];
  dp: number[];
  count: number[];
  target: number[];
  cost: number;
}

function cloneState(st: State): State {
  return {
    rows: st.rows.map(r => r.slice()),
    last: st.last.slice(), lastShift: st.lastShift.slice(), dp: st.dp.slice(),
    count: st.count.slice(), target: st.target.slice(), cost: st.cost,
  };
}

export function solveSchedule(
  emps: SolverEmployee[],
  days: number,
  adjacentAllowed: (a: string, b: string) => boolean,
  beamWidth = 60,
  hooks?: SolverHooks,
): string[][] {
  const n = emps.length;
  if (n === 0) return [];
  const idOf = new Map(emps.map((e, i) => [e.profile_id, i]));
  const prefSet = emps.map(e => new Set(e.preferences.filter(p => idOf.has(p))));
  const hasPref = prefSet.map(s => s.size > 0);
  const excl = new Set(hooks?.balanceExclude || []);
  const groups = emps.map((e, i) => (excl.has(i) ? 'X' : hooks?.balanceAll ? 'ALL' : group(e)));
  const balW = BAL * (hooks?.balanceWeight || 1);
  // Сотрудник по схеме (СТ «Д+Н», МЛ серии) отрабатывает смены парами/сериями, одиночный — по одной.
  // Чтобы количество выходов было сопоставимо, считаем в «сменах»: каждая смена = 1.
  const weight = emps.map(() => 1);
  const groupIdx: Record<string, number[]> = { СТ: [], МЛ: [], СТx: [], МЛx: [], ЛБ: [], ALL: [], X: [] };
  groups.forEach((g, i) => groupIdx[g].push(i));

  // Варианты одного дня для одного состояния: перебор всех расстановок 4 смен, лучшие topK.
  const expand = (st: State, d: number, topK: number, noise: number): { combo: number[]; c: number }[] => {
    const dayNum = d + 1;
    const dayByNoNight: boolean[] = [];
    if (d > 0) {
      const who = st.rows.findIndex(r => r[d - 1] === 'Д');
      dayByNoNight[d - 1] = who >= 0 && emps[who].status === 'СТ' && emps[who].no_night;
    }
    const mean: Record<string, number> = {};
    for (const g of Object.keys(groupIdx)) {
      const idx = groupIdx[g];
      mean[g] = idx.length ? idx.reduce((s, i) => s + st.count[i], 0) / idx.length : 0;
    }
    const skip = Array(n).fill(0);
    const pen: number[][] = Array.from({ length: n }, () => [Infinity, Infinity, Infinity, Infinity]);
    for (let p = 0; p < n; p++) {
      const e = emps[p];
      const prev = d > 0 ? st.rows[p][d - 1] : '';
      const gap = d - st.last[p];
      const dpn = st.dp[p];
      if (isSt(e)) {
        if (prev === 'Д') skip[p] = RULE;
      } else if (isMl(e)) {
        const atStart = d - dpn === 0;
        if (dpn >= 3 || (dpn > 0 && !atStart)) skip[p] = RULE;
      }
      if (hooks?.skipCost) skip[p] += hooks.skipCost(p, d, st.rows);
      SLOTS.forEach((s, si) => {
        if (!allowed(e, s, dayNum)) return;
        let c = 0;
        if (hooks?.slotCost) {
          const h = hooks.slotCost(p, s, d, st.rows);
          if (!Number.isFinite(h)) return;
          c += h;
        }
        if (isSt(e)) {
          // В первый день месяца «Н» — продолжение пары с прошлого месяца.
          // Если вчерашнюю «Д» отработал СТ без ночей (запрет ночей) — его пару закрывает другой СТ:
          // это единственное допустимое исключение, иначе такой сотрудник не смог бы работать вовсе.
          if (s === 'Н') {
            if (prev !== 'Д' && d > 0) {
              c += dayByNoNight[d - 1] ? (hooks?.noNightCost ?? NO_NIGHT_COST) : RULE;
              if (gap <= Math.max(1, e.break_days)) c += RULE;
            }
          } else {
            if (prev) c += RULE;
            if (gap <= Math.max(1, e.break_days)) c += RULE;
            if (d + 1 < days && !allowed(e, 'Н', dayNum + 1)) c += RULE;
          }
        } else if (isMl(e)) {
          const atStart = d - dpn === 0 && dpn > 0;
          // «Нп» — только конец серии из 3–6 «Дп» (или серия, начатая в прошлом месяце).
          // В самый первый день месяца «Нп» без серии допустима — это конец серии прошлого месяца.
          if (s === 'Нп') {
            const monthStart = d === 0;
            if (!(dpn >= 3 || atStart || monthStart)) c += RULE;
            if (dpn === 0 && !monthStart && gap <= 2) c += RULE;
          }
          else {
            if (dpn >= 6) c += RULE;
            if (dpn === 0 && gap <= 2) c += RULE;
            if (dpn >= st.target[p]) c += 8;
            if (dpn === 0) for (let k = 1; k <= 3 && d + k < days; k++) if (!allowed(e, 'Дп', dayNum + k)) { c += 40; break; }
          }
        } else {
          if (gap <= e.break_days) c += RULE;
          if (gap === 1 && !adjacentAllowed(st.lastShift[p], s)) c += RULE;
        }
        if (groups[p] !== 'X') c += (st.count[p] - mean[groups[p]]) * balW;
        c += e.priority * 0.3;
        pen[p][si] = c;
      });
    }
    const skipTotal = skip.reduce((s, v) => s + v, 0);
    const cand = SLOTS.map((_, si) => {
      const list: number[] = [];
      for (let p = 0; p < n; p++) if (pen[p][si] < Infinity) list.push(p);
      list.push(-1);
      return list;
    });
    const out: { combo: number[]; c: number }[] = [];
    const pick = [-1, -1, -1, -1];
    const used = new Set<number>();
    const rec = (si: number) => {
      if (si === 4) {
        let c = skipTotal;
        if (hooks?.comboCost) c += hooks.comboCost(pick, d);
        for (let k = 0; k < 4; k++) {
          const p = pick[k];
          if (p < 0) { c += EMPTY; continue; }
          c += pen[p][k] - skip[p];
          if (hasPref[p]) {
            // Напарник по той же смене: день — Д и Дп, ночь — Н и Нп.
            const partner = pick[PARTNER[k]];
            if (partner < 0 || !prefSet[p].has(emps[partner].profile_id)) return;
            if (hasPref[partner] && !prefSet[partner].has(emps[p].profile_id)) return;
          }
        }
        out.push({ combo: pick.slice(), c: c + Math.random() * noise });
        return;
      }
      for (const p of cand[si]) {
        if (p >= 0 && used.has(p)) continue;
        pick[si] = p;
        if (p >= 0) used.add(p);
        rec(si + 1);
        if (p >= 0) used.delete(p);
      }
      pick[si] = -1;
    };
    rec(0);
    out.sort((a, b) => a.c - b.c);
    return out.slice(0, topK);
  };

  const apply = (st: State, d: number, combo: number[], c: number): State => {
    const ns = cloneState(st);
    ns.cost += c;
    const worked = new Set<number>();
    combo.forEach((p, si) => {
      if (p < 0) return;
      const s = SLOTS[si];
      ns.rows[p][d] = s;
      worked.add(p);
      ns.last[p] = d;
      ns.lastShift[p] = s;
      ns.count[p] += weight[p];
      if (s === 'Дп') ns.dp[p]++; else ns.dp[p] = 0;
      if (s === 'Нп') ns.target[p] = 3 + Math.floor(Math.random() * 4);
    });
    for (let p = 0; p < n; p++) if (!worked.has(p)) ns.dp[p] = 0;
    return ns;
  };

  const finalScore = (st: State) => {
    let spread = 0;
    for (const g of ['СТ', 'МЛ', 'СТx', 'МЛx', 'ALL']) {
      const idx = groupIdx[g];
      if (!idx.length) continue;
      const m = idx.reduce((s, i) => s + st.count[i], 0) / idx.length;
      spread += idx.reduce((s, i) => s + (st.count[i] - m) ** 2, 0);
    }
    return st.cost + spread * balW;
  };

  let best: State | null = null;
  const deadline = Date.now() + 2500;
  for (let run = 0; run < 6 && (run === 0 || Date.now() < deadline); run++) {
    let beam: State[] = [{
      rows: Array.from({ length: n }, () => Array(days).fill('')),
      last: Array(n).fill(-99), lastShift: Array(n).fill(''), dp: Array(n).fill(0),
      count: Array(n).fill(0), target: Array(n).fill(0).map(() => 3 + Math.floor(Math.random() * 4)), cost: 0,
    }];
    const noise = run === 0 ? 0.5 : 3 + run * 2;
    for (let d = 0; d < days; d++) {
      const next: State[] = [];
      for (const st of beam) for (const o of expand(st, d, 8, noise)) next.push(apply(st, d, o.combo, o.c));
      next.sort((a, b) => a.cost - b.cost);
      // Разнообразие: не держим в луче одинаковые сегодняшние расстановки.
      const seen = new Set<string>();
      beam = [];
      for (const s of next) {
        const key = s.rows.map(r => r[d] + (d > 0 ? r[d - 1] : '')).join('|') + Math.round(s.cost / 50);
        if (seen.has(key)) continue;
        seen.add(key);
        beam.push(s);
        if (beam.length >= beamWidth) break;
      }
    }
    for (const st of beam) if (!best || finalScore(st) < finalScore(best)) best = st;
  }
  return best ? best.rows : [];
}
