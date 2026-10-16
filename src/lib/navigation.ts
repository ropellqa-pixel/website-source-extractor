import type { UserRole } from './auth';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  group: number;
  roles?: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Главная', path: '/dashboard', icon: 'House', group: 0 },
  { label: 'Документация', path: '/documents', icon: 'FileText', group: 1 },
  { label: 'База документов', path: '/base', icon: 'Database', group: 1 },
  { label: 'ДТО', path: '/dto', icon: 'Briefcase', group: 1 },
  { label: 'Чат', path: '/chat', icon: 'MessageSquare', group: 1 },
  { label: 'Камеры', path: '/cameras', icon: 'Cctv', group: 1 },
  { label: 'СКУД', path: '/skud', icon: 'DoorClosed', group: 1, roles: ['director', 'deputy_director', 'senior_employee'] },
  { label: 'Табель', path: '/schedule', icon: 'CalendarDays', group: 2 },
  { label: 'Зарплата', path: '/salary', icon: 'Banknote', group: 2 },
  { label: 'Инкассация', path: '/collection', icon: 'Coins', group: 2 },
  { label: 'Бухгалтерия', path: '/accounting', icon: 'Calculator', group: 2 },
  { label: 'СБЕР', path: '/sber', icon: 'Landmark', group: 2, roles: ['director', 'deputy_director', 'senior_employee'] },
  { label: 'Сотрудники', path: '/employees', icon: 'Users', group: 3, roles: ['director', 'deputy_director'] },
  { label: 'Админ-панель', path: '/admin', icon: 'SlidersHorizontal', group: 3, roles: ['deputy_director'] },
  { label: 'Управление ПК', path: '/devices', icon: 'MonitorSmartphone', group: 3, roles: ['deputy_director'] },
  { label: 'Настройки', path: '/settings', icon: 'Settings', group: 3 },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  director: 'Директор',
  deputy_director: 'Зам. директора',
  senior_employee: 'Старший сотрудник',
  employee: 'Сотрудник',
};

export function visibleNav(role: UserRole | undefined, sections?: string[] | null) {
  if (role === 'deputy_director') return NAV_ITEMS;
  if (sections) return NAV_ITEMS.filter(i => i.path === '/dashboard' || (sections.includes(i.path) && i.path !== '/admin' && i.path !== '/devices'));
  return NAV_ITEMS.filter(i => !i.roles || (role && i.roles.includes(role)));
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export function shortName(name: string) {
  const [last, first, middle] = name.trim().split(/\s+/);
  if (!last) return '';
  return [last, first ? `${first[0]}.` : '', middle ? `${middle[0]}.` : ''].filter(Boolean).join(' ');
}