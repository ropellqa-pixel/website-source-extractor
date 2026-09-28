import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/lib/sdk';
import { useAuth } from '@/lib/auth';
import { ensureWorkingRoom } from '@/lib/chatRoom';
import { incrementUnread, isChatActive } from '@/lib/chatUnread';

const POLL_MS = 6000;
const NOTIFICATION_AUTOCLOSE_MS = 5 * 60 * 1000; // 5 минут висит на ПК
const SEEN_KEY = 'anodbiz_chat_last_seen_id';
const SOUND_URL = '/sounds/notification.mp3';

function getLastSeenId(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
function setLastSeenId(id: string) {
  try { localStorage.setItem(SEEN_KEY, id); } catch { /* ignore */ }
}

/**
 * Глобальный «слушатель» общего чата: работает на любой странице приложения (подключён в AppShell).
 * При новом сообщении от другого человека:
 *  - проигрывает громкий звук,
 *  - на ПК/десктопе показывает системное уведомление, которое само закрывается через 5 минут,
 *  - на телефоне системное уведомление вибрирует и выезжает как обычно у push-уведомлений,
 *  - увеличивает счётчик непрочитанных (badge в меню), если пользователь не находится на странице чата.
 */
export function useChatNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  const playSound = useCallback(() => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio(SOUND_URL);
        audioRef.current.volume = 1;
      }
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => { /* автоплей может быть заблокирован до первого клика */ });
    } catch { /* ignore */ }
  }, []);

  const vibrate = useCallback(() => {
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
  }, []);

  const showNotification = useCallback((title: string, body: string) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, {
        body,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: 'anodbiz-chat',
        requireInteraction: false,
        silent: true, // звук уже проигрываем сами — управляемо и громко
      });
      n.onclick = () => {
        window.focus();
        navigate('/chat');
        n.close();
      };
      // На ПК уведомление само не исчезает — закрываем вручную через 5 минут
      setTimeout(() => { try { n.close(); } catch { /* ignore */ } }, NOTIFICATION_AUTOCLOSE_MS);
    } catch { /* ignore */ }
  }, [navigate]);

  useEffect(() => {
    if (!user) return;

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => { /* ignore */ });
    }

    let cancelled = false;

    const poll = async () => {
      try {
        let roomId = roomIdRef.current;
        if (!roomId) {
          const room = await ensureWorkingRoom();
          if (!room) return;
          roomId = room.id;
          roomIdRef.current = roomId;
        }

        const { data } = await db
          .from('chat_messages')
          .select('*')
          .eq('room_id', roomId)
          .order('created_at', { ascending: false })
          .limit(20);
        if (cancelled || !data || data.length === 0) return;

        const lastSeen = getLastSeenId();

        if (!initializedRef.current) {
          // Первая загрузка после открытия приложения — просто запоминаем текущее последнее сообщение,
          // чтобы не спамить уведомлениями о старой переписке.
          initializedRef.current = true;
          if (!lastSeen) setLastSeenId(data[0].id);
          return;
        }

        const newest = [...data].reverse(); // от старых к новым
        // Берём все сообщения после последнего увиденного id по порядку списка
        const lastSeenIdx = newest.findIndex((m: Record<string, unknown>) => m.id === lastSeen);
        const incoming = lastSeenIdx >= 0 ? newest.slice(lastSeenIdx + 1) : (lastSeen ? [] : newest);

        const othersIncoming = incoming.filter((m: Record<string, unknown>) => m.sender_id !== user.id);

        if (incoming.length > 0) {
          setLastSeenId(String(newest[newest.length - 1].id));
        }

        if (othersIncoming.length > 0 && !isChatActive()) {
          incrementUnread(othersIncoming.length);
          playSound();
          vibrate();
          const last = othersIncoming[othersIncoming.length - 1] as Record<string, unknown>;
          const title = othersIncoming.length === 1
            ? `${last.sender_name || 'Сотрудник'} · РАБОЧИЙ`
            : `РАБОЧИЙ · ${othersIncoming.length} новых сообщений`;
          const body = String(last.content || '').slice(0, 140);
          showNotification(title, body);
        }
      } catch {
        /* тихо игнорируем — это фоновый поллинг */
      }
    };

    poll();
    pollRef.current = setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user, playSound, vibrate, showNotification]);
}