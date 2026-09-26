/**
 * Стартовые демо-данные: чтобы кабинет не был пустым при первом входе.
 * Директор: director@anodbiz.ru / anodbiz, PIN 1234.
 * Сотрудник: petrova@anodbiz.ru / anodbiz, PIN 2222.
 */
const SEED_KEY = 'anod_seed_v1';
const P = 'anod_db_';

let seeding = false;

export const DEMO = {
  director: { email: 'director@anodbiz.ru', password: 'anodbiz', pin: '1234' },
  employee: { email: 'petrova@anodbiz.ru', password: 'anodbiz', pin: '2222' },
};

export function seedIfEmpty() {
  if (seeding) return;
  try {
    if (localStorage.getItem(SEED_KEY)) return;
  } catch {
    return;
  }
  seeding = true;
  const now = new Date().toISOString();
  const dirUser = 'a0000000-0000-4000-8000-000000000001';
  const empUser = 'a0000000-0000-4000-8000-000000000002';

  localStorage.setItem('anod_auth_users', JSON.stringify([
    { id: dirUser, email: DEMO.director.email, password: DEMO.director.password, roles: ['admin'], created_at: now },
    { id: empUser, email: DEMO.employee.email, password: DEMO.employee.password, roles: [], created_at: now },
  ]));

  const profiles = [
    { id: 'p-dir', user_id: dirUser, full_name: 'Иванов Иван Иванович', email: DEMO.director.email, role: 'director', department: 'Руководство' },
    { id: 'p-dep', user_id: 'u-dep', full_name: 'Смирнова Ольга Петровна', email: 'smirnova@anodbiz.ru', role: 'deputy_director', department: 'Руководство' },
    { id: 'p-sen', user_id: 'u-sen', full_name: 'Кузнецов Андрей Сергеевич', email: 'kuznetsov@anodbiz.ru', role: 'senior_employee', department: 'Производство' },
    { id: 'p-emp', user_id: empUser, full_name: 'Петрова Мария Алексеевна', email: DEMO.employee.email, role: 'employee', department: 'Производство' },
    { id: 'p-e2', user_id: 'u-e2', full_name: 'Соколов Дмитрий Игоревич', email: 'sokolov@anodbiz.ru', role: 'employee', department: 'Производство' },
    { id: 'p-e3', user_id: 'u-e3', full_name: 'Волкова Анна Викторовна', email: 'volkova@anodbiz.ru', role: 'employee', department: 'Склад' },
  ].map(p => ({ ...p, status: 'active', has_system_access: true, vk_id: null, vk_link: null, created_at: now }));

  const tables: Record<string, unknown[]> = {
    profiles,
    pin_codes: [
      { id: 'pin-1', user_id: dirUser, pin: DEMO.director.pin, email: DEMO.director.email, shortcut_code: 'default', created_at: now },
      { id: 'pin-2', user_id: empUser, pin: DEMO.employee.pin, email: DEMO.employee.email, shortcut_code: 'default', created_at: now },
    ],
    documents: [
      { id: 'd1', title: 'Регламент приёмки анодированных деталей', content: 'Порядок входного и выходного контроля покрытия: толщина слоя, цвет, отсутствие пятен.', author: 'Иванов И. И.', created_at: '2026-09-12', updated_at: '2026-09-20', tags: ['регламент', 'качество'] },
      { id: 'd2', title: 'Инструкция по охране труда', content: 'Работа с кислотными ваннами допускается только в защитной экипировке.', author: 'Смирнова О. П.', created_at: '2026-08-30', updated_at: '2026-09-02', tags: ['охрана труда'] },
      { id: 'd3', title: 'График технического обслуживания линии', content: 'Еженедельная проверка выпрямителей и замена электролита раз в квартал.', author: 'Кузнецов А. С.', created_at: '2026-09-18', updated_at: '2026-09-18', tags: ['оборудование'] },
    ],
    folders: [
      { id: 'f1', name: 'Договоры', parent_id: null, created_at: now },
      { id: 'f2', name: 'Сертификаты', parent_id: null, created_at: now },
      { id: 'f3', name: 'Кадры', parent_id: null, created_at: now },
    ],
    dto_templates: [
      { id: 't1', name: 'Договор поставки', category_id: 'contract', content: 'ДОГОВОР ПОСТАВКИ №___\n\nООО «АнодБИЗ», именуемое в дальнейшем «Поставщик»...', description: 'Типовой договор на поставку продукции', created_at: now, usage_count: 12 },
      { id: 't2', name: 'Акт выполненных работ', category_id: 'act', content: 'АКТ №___\n\nИсполнитель выполнил работы по анодированию...', description: 'Акт сдачи-приёмки работ', created_at: now, usage_count: 7 },
    ],
    chat_rooms: [
      { id: 'r1', name: 'Общий чат', type: 'group', participants: [], created_at: now },
      { id: 'r2', name: 'Производство', type: 'group', participants: [], created_at: now },
    ],
    chat_messages: [
      { id: 'm1', room_id: 'r1', sender_id: 'u-dep', sender_name: 'Смирнова Ольга Петровна', content: 'Коллеги, табель за сентябрь закрыт. Проверьте свои смены.', read: false, created_at: '2026-09-25T09:12:00.000Z' },
      { id: 'm2', room_id: 'r1', sender_id: 'u-sen', sender_name: 'Кузнецов Андрей Сергеевич', content: 'Принято, всё сходится.', read: false, created_at: '2026-09-25T09:20:00.000Z' },
    ],
  };

  for (const [name, rows] of Object.entries(tables)) {
    localStorage.setItem(P + name, JSON.stringify(rows));
  }
  localStorage.setItem('biz_company', JSON.stringify({
    id: 'comp_anodbiz', name: 'ООО «АнодБИЗ»', inn: '7700000000', ogrn: '1027700000000', type: 'ООО', createdAt: now,
  }));
  // Демо-режим: при первом открытии кабинет сразу показывает данные директора
  localStorage.setItem('anod_auth_session', JSON.stringify({ user: { id: dirUser, email: DEMO.director.email } }));
  localStorage.setItem(SEED_KEY, '1');
  seeding = false;
}
