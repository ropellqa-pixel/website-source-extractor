"""Права доступа по должностям. Файл одинаковый в accounting-api и admin-api."""
import json
from typing import Any, Dict, List, Optional, Set

DEPUTY = 'deputy_director'

SECTIONS: List[Dict[str, str]] = [
    {'path': '/dashboard', 'label': 'Главная'},
    {'path': '/documents', 'label': 'Документация'},
    {'path': '/base', 'label': 'База документов'},
    {'path': '/dto', 'label': 'ДТО'},
    {'path': '/chat', 'label': 'Чат'},
    {'path': '/cameras', 'label': 'Камеры'},
    {'path': '/skud', 'label': 'СКУД'},
    {'path': '/schedule', 'label': 'Табель'},
    {'path': '/salary', 'label': 'Зарплата'},
    {'path': '/collection', 'label': 'Инкассация'},
    {'path': '/accounting', 'label': 'Бухгалтерия'},
    {'path': '/sber', 'label': 'СБЕР (оплаты)'},
    {'path': '/employees', 'label': 'Сотрудники'},
    {'path': '/settings', 'label': 'Настройки'},
]

ACTIONS: List[Dict[str, str]] = [
    {'key': 'accounting.view_entries', 'group': 'Бухгалтерия', 'label': 'Видеть доходы и расходы'},
    {'key': 'accounting.edit_entries', 'group': 'Бухгалтерия', 'label': 'Добавлять и изменять операции'},
    {'key': 'accounting.delete_entries', 'group': 'Бухгалтерия', 'label': 'Удалять операции'},
    {'key': 'accounting.view_reports', 'group': 'Бухгалтерия', 'label': 'Видеть прибыль и отчёт ДДС'},
    {'key': 'accounting.view_budget', 'group': 'Бухгалтерия', 'label': 'Видеть план-факт бюджет'},
    {'key': 'accounting.edit_budget', 'group': 'Бухгалтерия', 'label': 'Составлять план бюджета'},
    {'key': 'accounting.view_counterparties', 'group': 'Бухгалтерия', 'label': 'Видеть контрагентов и долги'},
    {'key': 'accounting.edit_counterparties', 'group': 'Бухгалтерия', 'label': 'Вести контрагентов и документы'},
    {'key': 'accounting.view_salary', 'group': 'Бухгалтерия', 'label': 'Видеть зарплату, долги и листки'},
    {'key': 'accounting.edit_salary', 'group': 'Бухгалтерия', 'label': 'Начислять и выплачивать зарплату'},
    {'key': 'accounting.close_month', 'group': 'Бухгалтерия', 'label': 'Закрывать / открывать месяц'},
    {'key': 'sber.view', 'group': 'СБЕР', 'label': 'Видеть заявки на оплату и выписку'},
    {'key': 'sber.request', 'group': 'СБЕР', 'label': 'Создавать заявки и отправлять директору'},
    {'key': 'sber.pay', 'group': 'СБЕР', 'label': 'Оплачивать заявки через СберБизнес'},
    {'key': 'sber.edit_requisites', 'group': 'СБЕР', 'label': 'Менять реквизиты контрагентов'},
    {'key': 'sber.sync', 'group': 'СБЕР', 'label': 'Обновлять выписку из банка'},
    {'key': 'salary.view_full', 'group': 'Зарплата', 'label': 'Видеть полную таблицу'},
    {'key': 'salary.edit', 'group': 'Зарплата', 'label': 'Вносить часы, выручку, удержания'},
    {'key': 'salary.manage_rows', 'group': 'Зарплата', 'label': 'Добавлять и удалять сотрудников'},
    {'key': 'salary.lock', 'group': 'Зарплата', 'label': 'Сохранять, блокировать, разблокировать'},
    {'key': 'salary.broadcast', 'group': 'Зарплата', 'label': 'Рассылать расчёт в ВК'},
    {'key': 'collection.edit', 'group': 'Инкассация', 'label': 'Вносить факт и статусы'},
    {'key': 'collection.import', 'group': 'Инкассация', 'label': 'Загружать файл СБИС'},
    {'key': 'collection.unlock', 'group': 'Инкассация', 'label': 'Разблокировать закрытый месяц'},
]
ALL_ACTIONS: Set[str] = {a['key'] for a in ACTIONS}
VIEW_ACTIONS: Set[str] = {a['key'] for a in ACTIONS if '.view' in a['key']}

ROLE_SECTIONS = {
    'director': [s['path'] for s in SECTIONS],
    'senior_employee': ['/dashboard', '/documents', '/base', '/dto', '/chat', '/cameras', '/schedule', '/salary',
                        '/collection', '/settings', '/sber'],
    'employee': ['/dashboard', '/documents', '/base', '/dto', '/chat', '/cameras', '/schedule', '/salary',
                 '/collection', '/settings'],
}
ROLE_ACTIONS = {
    'director': VIEW_ACTIONS | {'collection.edit', 'collection.import', 'collection.unlock', 'sber.pay', 'sber.sync'},
    'senior_employee': {'sber.view', 'sber.request'},
    'employee': set(),
}


def _j(v: Any) -> Any:
    return v if isinstance(v, (list, dict)) else json.loads(v or '[]')


def current_user(cur, schema: str, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    headers = event.get('headers') or {}
    token = (headers.get('X-Authorization') or headers.get('x-authorization') or '').replace('Bearer ', '').strip()
    if not token:
        return None
    cur.execute(f'SELECT u.id, u.email, u.is_admin FROM {schema}.auth_sessions s JOIN {schema}.auth_users u '
                f'ON u.id = s.user_id WHERE s.token = %s AND s.expires_at > now()', (token,))
    row = cur.fetchone()
    if not row:
        cur.execute(f'SELECT u.id, u.email, u.is_admin FROM {schema}.api_tokens t JOIN {schema}.auth_users u '
                    f'ON u.id = t.user_id WHERE t.token = %s AND t.revoked_at IS NULL', (token,))
        row = cur.fetchone()
    if not row:
        return None
    cur.execute(f'SELECT p.id, p.role, p.full_name, p.position_id, pos.name, pos.sections, pos.actions '
                f'FROM {schema}.profiles p LEFT JOIN {schema}.positions pos ON pos.id = p.position_id '
                f'WHERE p.user_id = %s OR lower(p.email) = lower(%s) ORDER BY (p.user_id = %s) DESC LIMIT 1',
                (row[0], row[1] or '', row[0]))
    prof = cur.fetchone()
    role = prof[1] if prof else ('director' if row[2] else 'employee')
    if row[2] and role not in ('director', DEPUTY):
        role = 'director'
    if role == DEPUTY:
        sections, actions = [s['path'] for s in SECTIONS] + ['/devices', '/admin'], set(ALL_ACTIONS)
    elif prof and prof[3] and prof[4] is not None:
        sections = [p for p in _j(prof[5]) if p != '/admin']
        actions = {a for a in _j(prof[6]) if a in ALL_ACTIONS}
    else:
        sections = list(ROLE_SECTIONS.get(role, ROLE_SECTIONS['employee']))
        actions = set(ROLE_ACTIONS.get(role, set()))
    if role == 'senior_employee':
        actions |= {'sber.view', 'sber.request'}
        if '/sber' not in sections:
            sections.append('/sber')
    elif role == 'director':
        actions |= {'sber.view', 'sber.request', 'sber.pay', 'sber.sync'}
        if '/sber' not in sections:
            sections.append('/sber')
    if '/dashboard' not in sections:
        sections.insert(0, '/dashboard')
    return {'id': row[0], 'profile_id': prof[0] if prof else None, 'role': role,
            'name': ((prof[2] if prof else '') or row[1] or '').strip(),
            'position_id': prof[3] if prof else None, 'position': prof[4] if prof else None,
            'sections': sections, 'actions': actions, 'is_deputy': role == DEPUTY}
