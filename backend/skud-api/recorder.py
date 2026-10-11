"""Видеорегистратор на ПК (программа АБИЗ): получает, какие камеры писать, и задания на отрывки."""
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import boto3

from visits import READY_DELAY, process

STUCK = timedelta(minutes=10)
MAX_ATTEMPTS = 6
KEEP_HOURS = 720
PENDING_HOURS = 24
PC_MAX_GB = 15
SITE_MAX_BYTES = 6 * 1024 ** 3
PART_BYTES = 1024 * 1024


def _s3():
    return boto3.client('s3', endpoint_url='https://bucket.poehali.dev',
                        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'])


def cdn(key: str) -> str:
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def device_by_token(cur, schema: str, token: str):
    if not token:
        return None
    cur.execute(f'SELECT d.device_code, d.hostname FROM {schema}.api_tokens t JOIN {schema}.devices d '
                f'ON d.device_code = t.device_code WHERE t.token = %s AND t.revoked_at IS NULL', (token,))
    r = cur.fetchone()
    return {'code': r[0], 'host': r[1]} if r else None


def poll(cur, schema: str, dev: Dict[str, Any], body: Dict[str, Any]) -> Dict[str, Any]:
    cur.execute(f'SELECT id, camera_id, inside_camera_id, recorder_quality FROM {schema}.skud_controllers '
                f'WHERE active AND recorder_device = %s', (dev['code'],))
    ctrls = cur.fetchall()
    if not ctrls:
        return {'recorder': False}
    status = str(body.get('status') or '')[:300]
    cams: Dict[str, str] = {}
    for c in ctrls:
        cur.execute(f'UPDATE {schema}.skud_controllers SET recorder_seen_at = now(), recorder_status = %s WHERE id = %s',
                    (status or None, c[0]))
        process(cur, schema, c[0])
        for cam in (c[1], c[2]):
            if cam:
                cams[cam] = c[3] or 'sd'
        if not c[2]:
            cur.execute(f"SELECT id FROM {schema}.cameras WHERE lower(replace(name, ' ', '')) IN ('склад-вн', 'складвн') LIMIT 1")
            x = cur.fetchone()
            if x:
                cams[x[0]] = c[3] or 'sd'
    now = datetime.now(timezone.utc)
    ids = tuple(c[0] for c in ctrls)
    cur.execute(
        f"UPDATE {schema}.skud_clips SET status = 'pending' WHERE status = 'taken' AND taken_at < %s AND attempts < %s",
        (now - STUCK, MAX_ATTEMPTS))
    cur.execute(
        f"UPDATE {schema}.skud_clips SET status = 'failed', error = COALESCE(error, 'Не удалось сохранить отрывок') "
        f"WHERE status IN ('pending', 'taken') AND (attempts >= %s OR clip_to < %s)",
        (MAX_ATTEMPTS, now - timedelta(hours=PENDING_HOURS)))
    cur.execute(
        f"SELECT c.id, c.camera_id, c.clip_from, c.clip_to, c.mode FROM {schema}.skud_clips c "
        f"JOIN {schema}.skud_visits v ON v.id = c.visit_id WHERE v.controller_id IN %s AND c.status = 'pending' "
        f"AND c.clip_to <= %s ORDER BY c.clip_to LIMIT 3", (ids, now - READY_DELAY))
    jobs: List[Dict[str, Any]] = []
    for r in cur.fetchall():
        key = f"skud/{r[2].astimezone(timezone(timedelta(hours=3))).strftime('%Y-%m')}/{uuid.uuid4().hex}.mp4"
        cur.execute(f"UPDATE {schema}.skud_clips SET status = 'taken', taken_at = now(), attempts = attempts + 1 WHERE id = %s",
                    (r[0],))
        jobs.append({'id': r[0], 'camera_id': r[1], 'from': r[2].isoformat(), 'to': r[3].isoformat(), 'mode': r[4],
                     'key': key})
    names = {}
    if cams:
        cur.execute(f'SELECT id, name FROM {schema}.cameras WHERE id IN %s', (tuple(cams),))
        names = dict(cur.fetchall())
    return {'recorder': True, 'cameras': [{'id': k, 'quality': v, 'name': names.get(k, 'камера')} for k, v in cams.items()],
            'keep_hours': KEEP_HOURS, 'max_disk_gb': PC_MAX_GB, 'part_bytes': PART_BYTES, 'jobs': jobs}


def site_cleanup(cur, schema: str) -> None:
    """Видео на сайте — не больше 6 ГБ: при превышении удаляются самые старые отрывки."""
    cur.execute(f"SELECT COALESCE(SUM(size_bytes), 0) FROM {schema}.skud_clips WHERE status = 'done'")
    total = int(cur.fetchone()[0])
    if total <= SITE_MAX_BYTES:
        return
    cur.execute(f"SELECT id, url, COALESCE(size_bytes, 0) FROM {schema}.skud_clips WHERE status = 'done' "
                f"ORDER BY clip_from LIMIT 200")
    s3 = None
    prefix = cdn('')
    for cid, url, size in cur.fetchall():
        if total <= SITE_MAX_BYTES:
            break
        if url and url.startswith(prefix):
            s3 = s3 or _s3()
            try:
                s3.delete_object(Bucket='files', Key=url[len(prefix):])
            except Exception as ex:
                print('site_cleanup delete error', url, repr(ex))
        cur.execute(f"UPDATE {schema}.skud_clips SET status = 'deleted', url = NULL, "
                    f"error = 'Видео удалено: на сайте храним не больше 6 ГБ' WHERE id = %s", (cid,))
        total -= int(size)


def upload_part(body: Dict[str, Any]) -> Dict[str, Any]:
    """Запасной путь, если прямая загрузка не сработала: файл частями по ~3 МБ (base64)."""
    import base64
    key = str(body.get('key') or '')
    if not key.startswith('skud/') or '..' in key:
        return {'error': 'bad key'}
    s3 = _s3()
    part_key = f"{key}.part{int(body.get('part') or 0):04d}"
    s3.put_object(Bucket='files', Key=part_key, Body=base64.b64decode(body.get('data') or ''))
    return {'ok': True}


def finish_parts(key: str, parts: int) -> int:
    s3 = _s3()
    data = b''.join(s3.get_object(Bucket='files', Key=f'{key}.part{i:04d}')['Body'].read() for i in range(parts))
    s3.put_object(Bucket='files', Key=key, Body=data, ContentType='video/mp4')
    for i in range(parts):
        s3.delete_object(Bucket='files', Key=f'{key}.part{i:04d}')
    return len(data)


def done(cur, schema: str, body: Dict[str, Any]) -> Dict[str, Any]:
    cid = body.get('id')
    if body.get('wait'):
        cur.execute(f"UPDATE {schema}.skud_clips SET status = 'pending', attempts = GREATEST(attempts - 1, 0), "
                    f"taken_at = NULL WHERE id = %s", (cid,))
        return {'ok': True}
    if body.get('error'):
        missing = bool(body.get('missing'))
        cur.execute(f"UPDATE {schema}.skud_clips SET status = %s, error = %s WHERE id = %s",
                    ('missing' if missing else 'pending', str(body['error'])[:300], cid))
        return {'ok': True}
    key = str(body.get('key') or '')
    if not key.startswith('skud/') or '..' in key:
        return {'error': 'bad key'}
    try:
        size = finish_parts(key, int(body.get('parts') or 0)) if body.get('parts') else \
            _s3().head_object(Bucket='files', Key=key)['ContentLength']
    except Exception as ex:
        print('rec_done error', key, repr(ex))
        cur.execute(f"UPDATE {schema}.skud_clips SET status = 'pending', error = %s WHERE id = %s",
                    ('Файл не дошёл до хранилища', cid))
        return {'error': 'Файл не найден в хранилище'}
    cur.execute(f"UPDATE {schema}.skud_clips SET status = 'done', url = %s, size_bytes = %s, duration_sec = %s, "
                f"done_at = now(), error = NULL WHERE id = %s", (cdn(key), size, body.get('duration'), cid))
    site_cleanup(cur, schema)
    return {'ok': True}
