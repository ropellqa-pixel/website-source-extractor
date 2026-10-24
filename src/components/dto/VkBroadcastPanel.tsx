import { vkAuth } from '@/lib/vkBinding';
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/sdk';
import { apiUrl } from '@/lib/apiUrls';
import { getAllVkBindings } from '@/lib/vkBinding';
import Icon from '@/components/ui/icon';

interface Person {
  id: string;
  full_name: string;
  department?: string;
}

const VK_API_URL = apiUrl('vk-api');

function toPngBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export default function VkBroadcastPanel() {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  useEffect(() => {
    if (!open || people.length) return;
    setLoading(true);
    Promise.all([db.from('profiles').select('*'), getAllVkBindings()]).then(([res, map]) => {
      const list = ((res.data || []) as Person[])
        .filter(p => map[p.id])
        .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
      setPeople(list);
      setBindings(map);
      setSelected(new Set(list.map(p => p.id)));
      setLoading(false);
    });
  }, [open, people.length]);

  const allChecked = useMemo(() => people.length > 0 && selected.size === people.length, [people, selected]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const onPhoto = async (f?: File) => {
    if (!f) return;
    setPhoto(await toPngBase64(f));
  };

  const send = async () => {
    const message = text.trim();
    if (!message && !photo) return;
    const items = people
      .filter(p => selected.has(p.id))
      .map(p => ({
        vk_user_id: bindings[p.id],
        message: message.replace(/\{имя\}/g, (p.full_name || '').split(' ')[1] || p.full_name || ''),
      }));
    if (!items.length) return;
    if (!confirm(`Отправить сообщение ${items.length} сотрудникам во ВКонтакте?`)) return;
    setSending(true);
    setResult('');
    try {
      const res = await fetch(VK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...vkAuth() },
        body: JSON.stringify({ action: 'broadcast', items, photo_base64: photo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка отправки');
      setResult(`✓ Отправлено ${data.sent} из ${items.length}` + (data.failed ? `. Не доставлено: ${data.failed}` : '') + (data.photo_error ? `. Фото не прикрепилось (ВК: ${data.photo_error})` : ''));
      if (!data.failed) { setText(''); setPhoto(null); }
    } catch (e) {
      setResult('✗ ' + (e instanceof Error ? e.message : 'Ошибка отправки'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl mb-6">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/15 text-blue-600 flex items-center justify-center">
            <Icon name="Send" size={20} />
          </div>
          <div className="text-left">
            <p className="font-semibold text-foreground">Рассылка сотрудникам ВКонтакте</p>
            <p className="text-xs text-muted-foreground">Любое сообщение всем или выбранным сотрудникам с привязанным ВК</p>
          </div>
        </div>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={20} className="text-muted-foreground" />
      </button>

      {open && (
        <div className="border-t border-border p-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={7}
              placeholder="Текст сообщения. Можно вставить {имя} — подставится имя сотрудника."
              className="w-full bg-background border border-border rounded-lg p-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-secondary">
                <Icon name="Image" size={16} />
                {photo ? 'Заменить фото' : 'Прикрепить фото'}
                <input type="file" accept="image/*" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />
              </label>
              {photo && (
                <div className="flex items-center gap-2">
                  <img src={photo} alt="" className="h-10 w-10 object-cover rounded" />
                  <button onClick={() => setPhoto(null)} className="text-sm text-red-600 hover:underline">Убрать</button>
                </div>
              )}
              <button
                onClick={send}
                disabled={sending || selected.size === 0 || (!text.trim() && !photo)}
                className="ml-auto bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:bg-primary/85 disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Icon name={sending ? 'Loader2' : 'Send'} size={16} className={sending ? 'animate-spin' : ''} />
                {sending ? 'Отправка...' : `Отправить (${selected.size})`}
              </button>
            </div>
            {result && (
              <p className={`text-sm ${result.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{result}</p>
            )}
          </div>

          <div className="border border-border rounded-lg flex flex-col max-h-80">
            <label className="flex items-center gap-2 p-3 border-b border-border text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() => setSelected(allChecked ? new Set() : new Set(people.map(p => p.id)))}
              />
              Все ({people.length})
            </label>
            <div className="overflow-y-auto p-1">
              {loading && <p className="p-3 text-sm text-muted-foreground">Загрузка...</p>}
              {!loading && people.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">Нет сотрудников с привязанным ВКонтакте</p>
              )}
              {people.map(p => (
                <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="truncate">{p.full_name || 'Без имени'}</span>
                  {p.department && <span className="ml-auto text-xs text-muted-foreground truncate">{p.department}</span>}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
