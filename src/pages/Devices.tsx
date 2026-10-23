import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import ReleasePanel from '@/components/devices/ReleasePanel';
import CardAccessSection from '@/components/devices/CardAccessSection';
import {
  getDevicesStatus, sendDeviceCommand, getDeviceLogs, deleteDevice, setEmployeePassword,
  type DeviceStatus, type DeviceLogEntry, type RemoteCommand,
} from '@/lib/devices';

const PRESENCE: Record<string, { label: string; dot: string; text: string }> = {
  working: { label: 'Работа в сети', dot: 'bg-emerald-500', text: 'text-emerald-600' },
  login: { label: 'В сети (экран входа)', dot: 'bg-amber-500', text: 'text-amber-600' },
  offline: { label: 'Не в сети', dot: 'bg-gray-400', text: 'text-muted-foreground' },
};

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return new Date(iso).toLocaleString('ru-RU');
}

export default function Devices() {
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DeviceStatus | null>(null);
  const [logs, setLogs] = useState<DeviceLogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [editDevice, setEditDevice] = useState<DeviceStatus | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    const { devices } = await getDevicesStatus();
    setDevices(devices);
    setLoading(false);
    setSelected((prev) => prev ? devices.find((d) => d.device_code === prev.device_code) || prev : prev);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // почти живой статус: обновляем каждые 5 секунд
    return () => clearInterval(t);
  }, [load]);

  const notify = (text: string) => { setToast(text); setTimeout(() => setToast(''), 3000); };

  const removeDevice = async (device: DeviceStatus) => {
    if (!confirm(`Удалить ПК «${device.hostname || device.device_code}» из списка? Чтобы вернуть его, программу АБИЗ на этом ПК нужно будет привязать заново.`)) return;
    setBusy(device.device_code + 'delete');
    try {
      await deleteDevice(device.device_code);
      setDevices((list) => list.filter((x) => x.device_code !== device.device_code));
      notify('ПК удалён');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Не удалось удалить ПК');
    } finally {
      setBusy(null);
    }
  };

  const run = async (device: DeviceStatus, command: RemoteCommand, payload?: Record<string, unknown>) => {
    setBusy(device.device_code + command);
    try {
      await sendDeviceCommand(device.device_code, command, payload);
      const labels: Record<RemoteCommand, string> = {
        lock: 'Команда «Заблокировать» отправлена',
        unlock: 'Команда «Разблокировать» отправлена',
        message: 'Сообщение отправлено на экран',
        screenshot: 'Запрошен снимок экрана — появится через несколько секунд',
        rudesktop: 'Запущен удалённый доступ на ПК',
        reload: 'Команда «Обновить» отправлена',
        logout: 'Команда «Выход» отправлена',
        login_user: 'Вход в АБИЗ как сотрудник выполнен',
        login_admin: 'Вход в АБИЗ как администратор выполнен',
        update: 'Команда «Обновить программу» отправлена',
      };
      notify(labels[command]);
      setTimeout(load, 1500);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Не удалось отправить команду');
    } finally {
      setBusy(null);
    }
  };

  const openLogs = async (device: DeviceStatus) => {
    setSelected(device);
    setLogsOpen(true);
    setLogs(await getDeviceLogs(device.device_code, 150));
  };

  const savePassword = async () => {
    if (!editDevice?.profile_id || editPassword.length < 6) return;
    setEditSaving(true);
    try {
      await setEmployeePassword(editDevice.profile_id, editPassword);
      setEditPassword('');
      notify('Пароль обновлён');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Не удалось сменить пароль');
    } finally {
      setEditSaving(false);
    }
  };

  const sendMessage = async () => {
    if (!selected || !msgText.trim()) return;
    await run(selected, 'message', { message: msgText.trim() });
    setMsgOpen(false);
    setMsgText('');
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground"><Icon name="Loader2" size={28} className="animate-spin" /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Icon name="MonitorSmartphone" size={22} /> Управление ПК
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Компьютеры с программой АБИЗ. Статус обновляется автоматически.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground hover:bg-secondary/70">
          <Icon name="RefreshCw" size={15} /> Обновить
        </button>
      </div>

      <ReleasePanel notify={notify} />

      {devices.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
          <Icon name="MonitorOff" size={34} className="mx-auto mb-3 opacity-60" />
          Нет компьютеров. Сначала привяжите ПК в разделе «Сотрудники → Устройства».
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {devices.map((d) => {
            const p = PRESENCE[d.presence] || PRESENCE.offline;
            const online = d.presence !== 'offline';
            return (
              <div key={d.device_code} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${p.dot} ${online ? 'animate-pulse' : ''}`} />
                      <span className={`text-sm font-semibold ${p.text}`}>{p.label}</span>
                    </div>
                    <div className="mt-1.5 truncate text-base font-bold text-foreground">
                      {d.profile_name || d.hostname || 'ПК без имени'}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {d.hostname && d.profile_name ? d.hostname + ' · ' : ''}код {d.device_code}
                      {d.app_version ? ` · v${d.app_version}` : ''}
                    </div>
                    {d.update_status && (
                      <div className={`mt-0.5 text-xs ${d.update_status.startsWith('ошибка') ? 'text-red-600' : 'text-blue-600'}`}>
                        Обновление: {d.update_status}
                      </div>
                    )}
                    {d.current_user_name && d.presence === 'working' && (
                      <div className="mt-0.5 text-xs text-emerald-600">В системе: {d.current_user_name}</div>
                    )}
                    <div className="mt-0.5 text-xs text-muted-foreground">Был на связи: {timeAgo(d.heartbeat_at)}</div>
                    {d.remote_lock && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600">
                        <Icon name="Lock" size={12} /> Заблокирован вами
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {d.remote_lock ? (
                    <button disabled={busy === d.device_code + 'unlock'} onClick={() => run(d, 'unlock')}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      <Icon name="LockOpen" size={13} /> Разблокировать
                    </button>
                  ) : (
                    <button disabled={!online || busy === d.device_code + 'lock'} onClick={() => run(d, 'lock')}
                      className="flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40">
                      <Icon name="Lock" size={13} /> Заблокировать
                    </button>
                  )}
                  <button disabled={!online} onClick={() => { setSelected(d); setMsgOpen(true); }}
                    className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70 disabled:opacity-40">
                    <Icon name="MessageSquare" size={13} /> Сообщение
                  </button>
                  <button disabled={!online || busy === d.device_code + 'rudesktop'} onClick={() => run(d, 'rudesktop')}
                    className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70 disabled:opacity-40">
                    <Icon name="Eye" size={13} /> Экран (RuDesktop)
                  </button>
                  <button disabled={!online || busy === d.device_code + 'reload'} onClick={() => run(d, 'reload')}
                    className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70 disabled:opacity-40">
                    <Icon name="RotateCw" size={13} /> Обновить страницу
                  </button>
                  {d.presence === 'login' && (
                    <>
                      <button disabled={!d.profile_id} onClick={() => run(d, 'login_user')}
                        title={d.profile_id ? 'Открыть рабочий стол АБИЗ под сотрудником этого ПК' : 'ПК не привязан к сотруднику'}
                        className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">
                        <Icon name="LogIn" size={13} /> Войти как сотрудник
                      </button>
                      <button onClick={() => run(d, 'login_admin')}
                        className="flex items-center gap-1 rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
                        <Icon name="ShieldCheck" size={13} /> Войти как админ
                      </button>
                    </>
                  )}
                  {d.presence === 'working' && (
                    <button onClick={() => run(d, 'logout')}
                      className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70">
                      <Icon name="LogOut" size={13} /> Выйти на экран входа
                    </button>
                  )}
                  <button disabled={!online} onClick={() => run(d, 'update')}
                    className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70 disabled:opacity-40">
                    <Icon name="CloudDownload" size={13} /> Обновить программу
                  </button>
                  {d.profile_id && (
                    <button onClick={() => { setEditDevice(d); setEditPassword(''); }}
                      className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70">
                      <Icon name="UserCog" size={13} /> Изменить сведения
                    </button>
                  )}
                  <button onClick={() => openLogs(d)}
                    className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70">
                    <Icon name="ScrollText" size={13} /> Журнал
                  </button>
                  <button disabled={busy === d.device_code + 'delete'} onClick={() => removeDevice(d)}
                    className="flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-40">
                    <Icon name="Trash2" size={13} /> Удалить ПК
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Диалог сообщения на экран */}
      {msgOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setMsgOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-bold text-foreground">Сообщение на весь экран</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Появится поверх всего на «{selected.profile_name || selected.hostname}».
            </p>
            <textarea value={msgText} onChange={(e) => setMsgText(e.target.value)} autoFocus rows={4}
              placeholder="Например: Зайдите в кабинет директора"
              className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setMsgOpen(false)} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-secondary">Отмена</button>
              <button disabled={!msgText.trim()} onClick={sendMessage}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                Отправить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Журнал активности */}
      {logsOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setLogsOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="text-lg font-bold text-foreground">Журнал · {selected.profile_name || selected.hostname}</h3>
              <button onClick={() => setLogsOpen(false)} className="rounded-full p-1.5 hover:bg-secondary"><Icon name="X" size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {logs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Пока нет записей</p>
              ) : (
                <ul className="space-y-2">
                  {logs.map((l, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="shrink-0 text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-foreground">{l.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {editDevice && editDevice.profile_id && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditDevice(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Изменить сведения · {editDevice.profile_name || editDevice.hostname}</h3>
              <button onClick={() => setEditDevice(null)} className="rounded-full p-1.5 hover:bg-secondary"><Icon name="X" size={18} /></button>
            </div>
            <CardAccessSection profileId={editDevice.profile_id} notify={(text) => notify(text)} />
            <div className="mt-5">
              <label className="mb-1 block text-sm font-semibold text-foreground">Пароль</label>
              <p className="mb-2 text-xs text-muted-foreground">Новый пароль для входа сотрудника в АнодБИЗ и АБИЗ.</p>
              <div className="flex gap-2">
                <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Не менее 6 символов"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                <button disabled={editPassword.length < 6 || editSaving} onClick={savePassword}
                  className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {editSaving ? <Icon name="Loader2" size={14} className="animate-spin" /> : <Icon name="Check" size={14} />}
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
