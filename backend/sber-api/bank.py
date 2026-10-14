"""Разбор банковской выписки СберБизнес: формат обмена с 1С (kl_to_1c.txt) и выгрузка Excel."""
import base64
import io
import re
from datetime import datetime
from typing import Any, Dict, List, Optional


def _num(s: Any) -> float:
    if s is None:
        return 0.0
    if isinstance(s, (int, float)):
        return float(s)
    t = re.sub(r'[^\d,.\-]', '', str(s)).replace(',', '.')
    if t.count('.') > 1:
        head, _, tail = t.rpartition('.')
        t = head.replace('.', '') + '.' + tail
    try:
        return float(t) if t not in ('', '-', '.') else 0.0
    except ValueError:
        return 0.0


def _date(s: Any) -> Optional[str]:
    if s is None or s == '':
        return None
    if hasattr(s, 'strftime'):
        return s.strftime('%Y-%m-%d')
    s = str(s).strip()[:10]
    for f in ('%d.%m.%Y', '%Y-%m-%d', '%d/%m/%Y', '%d.%m.%y'):
        try:
            return datetime.strptime(s, f).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None


def _decode(raw: bytes) -> str:
    for enc in ('utf-8-sig', 'cp1251'):
        try:
            text = raw.decode(enc)
            if '1CClientBankExchange' in text or 'СекцияДокумент' in text or enc == 'cp1251':
                return text
        except UnicodeDecodeError:
            continue
    return raw.decode('cp1251', errors='replace')


def parse_1c(text: str) -> Dict[str, Any]:
    """Формат 1CClientBankExchange: секции СекцияДокумент=... / КонецДокумента."""
    head: Dict[str, str] = {}
    docs: List[Dict[str, str]] = []
    cur: Optional[Dict[str, str]] = None
    for line in text.splitlines():
        line = line.strip()
        if not line or '=' not in line and not line.startswith('КонецДокумента'):
            continue
        if line.startswith('СекцияДокумент'):
            cur = {'_type': line.split('=', 1)[1].strip()}
            continue
        if line.startswith('КонецДокумента'):
            if cur is not None:
                docs.append(cur)
            cur = None
            continue
        k, _, v = line.partition('=')
        if cur is not None:
            cur[k.strip()] = v.strip()
        else:
            head.setdefault(k.strip(), v.strip())
    account = head.get('РасчСчет', '')
    ops = []
    for d in docs:
        payer_acc = d.get('ПлательщикСчет') or d.get('ПлательщикРасчСчет', '')
        receiver_acc = d.get('ПолучательСчет') or d.get('ПолучательРасчСчет', '')
        if d.get('ДатаСписано'):
            kind, day = 'expense', _date(d.get('ДатаСписано'))
        elif d.get('ДатаПоступило'):
            kind, day = 'income', _date(d.get('ДатаПоступило'))
        elif account and payer_acc == account:
            kind, day = 'expense', _date(d.get('Дата'))
        else:
            kind, day = 'income', _date(d.get('Дата'))
        if kind == 'expense':
            name = d.get('Получатель1') or d.get('Получатель', '')
            inn = d.get('ПолучательИНН', '')
        else:
            name = d.get('Плательщик1') or d.get('Плательщик', '')
            inn = d.get('ПлательщикИНН', '')
        name = re.sub(r'^ИНН\s*\d+\s*', '', name).strip()
        ops.append({'date': day, 'kind': kind, 'amount': round(_num(d.get('Сумма')), 2), 'number': d.get('Номер', ''),
                    'name': name, 'inn': re.sub(r'\D', '', inn), 'purpose': d.get('НазначениеПлатежа', ''),
                    'other_account': receiver_acc if kind == 'expense' else payer_acc, 'doc_type': d.get('_type', '')})
    return {'account': account, 'date_from': _date(head.get('ДатаНачала')), 'date_to': _date(head.get('ДатаКонца')), 'ops': ops}


HEADERS = {
    'date': ['дата проводки', 'дата операции', 'дата'],
    'debit': ['сумма по дебету', 'дебет', 'списание', 'расход', 'сумма списания'],
    'credit': ['сумма по кредиту', 'кредит', 'поступление', 'приход', 'сумма поступления'],
    'amount': ['сумма'],
    'name': ['контрагент', 'наименование контрагента', 'корреспондент', 'плательщик/получатель', 'наименование'],
    'inn': ['инн контрагента', 'инн'],
    'purpose': ['назначение платежа', 'назначение', 'основание'],
    'number': ['№ документа', 'номер документа', '№ док', 'номер'],
}


def parse_xlsx(raw: bytes) -> Dict[str, Any]:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    cols: Dict[str, int] = {}
    start = 0
    for i, r in enumerate(rows[:40]):
        cells = [str(c or '').strip().lower() for c in r]
        found: Dict[str, int] = {}
        for key, names in HEADERS.items():
            for j, c in enumerate(cells):
                if c and any(c == n or c.startswith(n) for n in names) and j not in found.values():
                    found.setdefault(key, j)
                    break
        if 'date' in found and ('debit' in found or 'credit' in found or 'amount' in found):
            cols, start = found, i + 1
            break
    if not cols:
        raise ValueError('Не нашёл в файле колонки «Дата» и «Сумма». Выгрузите выписку из СберБизнес в формате 1С (.txt) или Excel.')
    ops = []
    for r in rows[start:]:
        g = lambda k: r[cols[k]] if k in cols and cols[k] < len(r) else None
        day = _date(g('date'))
        if not day:
            continue
        deb, cred = _num(g('debit')), _num(g('credit'))
        if not deb and not cred and 'amount' in cols:
            a = _num(g('amount'))
            deb, cred = (-a, 0.0) if a < 0 else (0.0, a)
        if deb:
            kind, amount = 'expense', abs(deb)
        elif cred:
            kind, amount = 'income', abs(cred)
        else:
            continue
        name = str(g('name') or '').strip()
        inn = re.search(r'\b(\d{10}|\d{12})\b', name + ' ' + str(g('inn') or ''))
        name = re.sub(r'ИНН\s*\d+', '', name).split('\n')[0].strip(' ,;')
        ops.append({'date': day, 'kind': kind, 'amount': round(amount, 2), 'number': str(g('number') or '').strip(),
                    'name': name, 'inn': inn.group(1) if inn else '', 'purpose': str(g('purpose') or '').strip(),
                    'other_account': '', 'doc_type': ''})
    dates = [o['date'] for o in ops]
    return {'account': '', 'date_from': min(dates) if dates else None, 'date_to': max(dates) if dates else None, 'ops': ops}


def parse_file(name: str, data_b64: str) -> Dict[str, Any]:
    raw = base64.b64decode(data_b64.split(',', 1)[-1])
    low = (name or '').lower()
    if low.endswith(('.xlsx', '.xlsm')) or raw[:2] == b'PK':
        return parse_xlsx(raw)
    text = _decode(raw)
    if 'СекцияДокумент' not in text:
        raise ValueError('Файл не похож на выписку. В СберБизнес: Выписки → Экспорт → формат «1С» (.txt) или Excel.')
    return parse_1c(text)


RULES = [
    (r'эквайр|торгов\w* уступ|возмещени\w* по операциям|по картам|pos', 'income', 'Эквайринг (оплата картой)'),
    (r'инкасс|взнос наличн|сдача выручки', 'income', 'Инкассация'),
    (r'комисси|плата за обслуж|тариф|ведение сч', 'expense', 'Банковские комиссии'),
    (r'налог|ндфл|страхов\w* взнос|енп|единый налог|казначейств|ифнс|сфр|пфр|фсс', 'expense', 'Налоги и взносы'),
    (r'аренд', 'expense', 'Аренда'),
    (r'заработн|зарплат|зп за|аванс за|отпускн|реестр', 'expense', 'Зарплата сотрудников'),
]


def guess_category(op: Dict[str, Any]) -> Optional[str]:
    text = f"{op.get('purpose', '')} {op.get('name', '')}".lower()
    for pattern, kind, cat in RULES:
        if kind == op['kind'] and re.search(pattern, text):
            return cat
    return None
