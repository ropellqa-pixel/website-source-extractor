/**
 * Лёгкое хранилище счётчика непрочитанных сообщений общего чата.
 * Работает без стейт-менеджера: держит значение в localStorage (переживает перезагрузку)
 * и рассылает событие в пределах вкладки, чтобы SideNav и сам чат синхронно обновлялись.
 */
const UNREAD_KEY = 'anodbiz_chat_unread';
const EVENT_NAME = 'anodbiz-chat-unread-changed';

export function getUnreadCount(): number {
  try {
    return Number(localStorage.getItem(UNREAD_KEY)) || 0;
  } catch {
    return 0;
  }
}

function persist(n: number) {
  try { localStorage.setItem(UNREAD_KEY, String(n)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent<number>(EVENT_NAME, { detail: n }));
}

export function setUnreadCount(n: number) {
  persist(Math.max(0, n));
}

export function incrementUnread(by = 1) {
  persist(getUnreadCount() + by);
}

export function resetUnread() {
  persist(0);
}

export function subscribeUnread(cb: (n: number) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<number>).detail ?? getUnreadCount());
  window.addEventListener(EVENT_NAME, handler);
  const storageHandler = (e: StorageEvent) => { if (e.key === UNREAD_KEY) cb(getUnreadCount()); };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

/** Флаг «пользователь сейчас смотрит на чат» — глобальной хук уведомлений не дублирует
 * звук/пуш, пока открыта страница чата (сообщения и так видны на экране). */
let chatActive = false;
export function setChatActive(active: boolean) { chatActive = active; }
export function isChatActive(): boolean { return chatActive; }

/** Отметить общий чат прочитанным на сервере — чтобы программа АБИЗ перестала напоминать. */
export async function markChatReadOnServer(): Promise<void> {
  try {
    const { default: func2url } = await import('../../backend/func2url.json');
    const url = (func2url as Record<string, string>)['device-control'];
    const token = localStorage.getItem('anod_session_token') || '';
    if (!url || !token) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Authorization': token },
      body: JSON.stringify({ action: 'chat_mark_read' }),
    });
  } catch { /* ignore */ }
}
