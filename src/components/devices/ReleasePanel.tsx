import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import {
  listReleases, publishRelease, activateRelease, deleteRelease, updateAllDevices, type AppRelease,
} from '@/lib/devices';

const EDITIONS: Record<'abiz' | 'admin', string> = { abiz: 'АБИЗ (киоск)', admin: 'АБИЗ-Админ' };

export default function ReleasePanel({ notify }: { notify: (t: string) => void }) {
  const [releases, setReleases] = useState<AppRelease[]>([]);
  const [open, setOpen] = useState(false);
  const [edition, setEdition] = useState<'abiz' | 'admin'>('abiz');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => listReleases().then(setReleases);
  useEffect(() => { load(); }, []);

  const versionOk = /^\d+(\.\d+){1,3}$/.test(version.trim());
  const submit = async () => {
    if (!file || !version.trim()) return;
    if (!versionOk) { setError('Номер версии — только цифры с точками, например 3.5'); return; }
    setError('');
    setProgress(0);
    try {
      await publishRelease(file, edition, version.trim(), notes.trim(), setProgress);
      notify(`Версия ${version} выпущена. ПК обновятся в течение 10 минут или сразу по кнопке «Обновить все ПК».`);
      setOpen(false); setFile(null); setVersion(''); setNotes('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setProgress(null);
    }
  };

  const pushAll = async () => {
    try {
      const n = await updateAllDevices();
      notify(`Команда «обновиться» отправлена на ${n} ПК`);
    } catch (e) { notify(e instanceof Error ? e.message : 'Ошибка'); }
  };

  const active = (ed: 'abiz' | 'admin') => releases.find(r => r.edition === ed && r.is_active);

  return (
    <div className="mb-5 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Icon name="CloudDownload" size={18} /> Обновление программы на ПК
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {(['abiz', 'admin'] as const).map(ed => (
              <span key={ed} className="mr-4">{EDITIONS[ed]}: <b className="text-foreground">{active(ed)?.version || 'не выпускалась'}</b></span>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={pushAll} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground hover:bg-secondary/70">
            <Icon name="RefreshCcw" size={15} /> Обновить все ПК сейчас
          </button>
          <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Icon name="Upload" size={15} /> Выпустить версию
          </button>
        </div>
      </div>

      {releases.length > 0 && (
        <div className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm">
          {releases.map(r => (
            <div key={r.id} className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-secondary">
              <span className="text-foreground">
                {EDITIONS[r.edition]} · <b>{r.version}</b>
                <span className="ml-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString('ru-RU')} · {(r.size / 1048576).toFixed(1)} МБ</span>
                {r.is_active && <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-700">текущая</span>}
              </span>
              <span className="flex gap-1">
                {!r.is_active && (
                  <button onClick={async () => { await activateRelease(r.id); load(); notify(`Вернули версию ${r.version}`); }}
                    className="rounded px-2 py-0.5 text-xs text-link hover:underline">Сделать текущей</button>
                )}
                <button onClick={async () => { if (confirm(`Удалить выпуск ${r.version}?`)) { await deleteRelease(r.id); load(); } }}
                  className="rounded px-2 py-0.5 text-xs text-red-600 hover:underline">Удалить</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => progress === null && setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-5" onClick={e => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-bold text-foreground">Выпустить новую версию</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Загрузите архив программы (ABIZ-…-win64.zip) и укажите номер версии из файла ПРОЧТИ.txt. Все ПК скачают обновление сами: на экране входа ставится сразу, у работающего сотрудника — после выхода. Кнопка «Обновить все ПК сейчас» ставит сразу везде.
            </p>
            <div className="mb-3 flex gap-2">
              {(['abiz', 'admin'] as const).map(ed => (
                <button key={ed} onClick={() => setEdition(ed)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm ${edition === ed ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}`}>
                  {EDITIONS[ed]}
                </button>
              ))}
            </div>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="Номер версии, например 3.5 (больше текущей)"
              className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Что нового (необязательно)" rows={2}
              className="mb-3 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
            <button onClick={() => fileRef.current?.click()}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-3 py-4 text-sm text-muted-foreground hover:bg-secondary">
              <Icon name="FileArchive" size={18} /> {file ? `${file.name} (${(file.size / 1048576).toFixed(1)} МБ)` : 'Выбрать ZIP-архив программы'}
            </button>
            {progress !== null && (
              <div className="mb-3">
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Загрузка… {Math.round(progress * 100)}%</div>
              </div>
            )}
            {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2">
              <button disabled={progress !== null} onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-secondary">Отмена</button>
              <button disabled={!file || !version.trim() || progress !== null} onClick={submit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                Выпустить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
