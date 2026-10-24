const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function triad(n: number, fem: boolean): string {
  const out: string[] = [];
  out.push(HUNDREDS[Math.floor(n / 100)]);
  const t = n % 100;
  if (t >= 10 && t < 20) out.push(TEENS[t - 10]);
  else {
    out.push(TENS[Math.floor(t / 10)]);
    out.push((fem ? ONES_F : ONES_M)[t % 10]);
  }
  return out.filter(Boolean).join(' ');
}

export function numberWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'ноль';
  const parts: string[] = [];
  const mln = Math.floor(n / 1_000_000);
  const th = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (mln) parts.push(`${triad(mln, false)} ${plural(mln, 'миллион', 'миллиона', 'миллионов')}`);
  if (th) parts.push(`${triad(th, true)} ${plural(th, 'тысяча', 'тысячи', 'тысяч')}`);
  if (rest) parts.push(triad(rest, false));
  return parts.join(' ');
}

export function rublesWords(amount: number): string {
  const rub = Math.floor(amount);
  const kop = Math.round((amount - rub) * 100);
  const w = numberWords(rub);
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} ${plural(rub, 'рубль', 'рубля', 'рублей')} ${String(kop).padStart(2, '0')} ${plural(kop, 'копейка', 'копейки', 'копеек')}`;
}

export function money(n: number): string {
  return `${Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} руб.`;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function dateLong(iso?: string | null): string {
  if (!iso) return '«___» __________ 20__ г.';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return `«${String(d.getDate()).padStart(2, '0')}» ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()} г.`;
}

export function dateShort(iso?: string | null): string {
  if (!iso) return '__.__.____';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('ru-RU');
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

export function blank(s: unknown, width = 18): string {
  const v = String(s ?? '').trim();
  return v ? esc(v) : `<span class="blank">${'_'.repeat(width)}</span>`;
}

export function initialsName(full: string): string {
  const p = (full || '').trim().split(/\s+/);
  if (p.length < 2) return full || '';
  return `${p[0]} ${p.slice(1).map(x => `${x.charAt(0)}.`).join('')}`;
}
