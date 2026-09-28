import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/auth';
import { db } from '@/lib/sdk';
import { ensureWorkingRoom, WORKING_CHAT_NAME, type ChatRoom } from '@/lib/chatRoom';
import { resetUnread, setChatActive } from '@/lib/chatUnread';
import { MessageSquare, Send, Users, Loader2 } from 'lucide-react';

interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  read: boolean;
  created_at: string;
}

function initials(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function formatTime(iso: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function formatDayLabel(iso: string) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday) return 'Сегодня';
    if (isYesterday) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  } catch { return ''; }
}

export default function Chat() {
  const { user } = useAuth();
  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadMessages = useCallback(async (roomId: string) => {
    try {
      const { data, error } = await db
        .from('chat_messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });
      if (!error && data) setMessages(data);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    setChatActive(true);
    resetUnread();
    return () => setChatActive(false);
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const r = await ensureWorkingRoom();
      setRoom(r);
      if (r) await loadMessages(r.id);
      setLoading(false);
    };
    init();
  }, [loadMessages]);

  // Пока пользователь на странице чата — обновляем переписку и сразу гасим счётчик непрочитанных
  useEffect(() => {
    if (!room) return;
    pollRef.current = setInterval(() => { loadMessages(room.id); resetUnread(); }, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [room, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    const text = newMessage.trim();
    if (!text || !room || !user || sending) return;
    setSending(true);
    setNewMessage('');
    try {
      const { data, error } = await db.from('chat_messages').insert({
        room_id: room.id,
        sender_id: user.id,
        sender_name: user.fullName || 'Сотрудник',
        content: text,
        read: false,
      }).select().single();
      if (!error && data) {
        setMessages(prev => [...prev, data]);
      } else {
        setNewMessage(text);
      }
    } catch {
      setNewMessage(text);
    }
    setSending(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Группируем сообщения по дням для аккуратных разделителей
  const groups: { day: string; items: ChatMessage[] }[] = [];
  for (const msg of messages) {
    const label = formatDayLabel(msg.created_at);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.day === label) {
      lastGroup.items.push(msg);
    } else {
      groups.push({ day: label, items: [msg] });
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-muted-foreground animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Загрузка чата...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-card backdrop-blur-sm border-b border-border px-4 sm:px-6 py-4 flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 shrink-0">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="font-semibold text-foreground truncate">{WORKING_CHAT_NAME}</h1>
          <p className="text-xs text-muted-foreground">Общий чат — доступен всем сотрудникам с доступом в систему</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-1">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-14 h-14 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground">Сообщений пока нет. Начните переписку!</p>
            </div>
          </div>
        ) : (
          groups.map((group, gi) => (
            <div key={gi}>
              <div className="flex items-center justify-center my-4">
                <span className="text-xs text-muted-foreground bg-secondary px-3 py-1 rounded-full">{group.day}</span>
              </div>
              {group.items.map((msg) => {
                const isMine = msg.sender_id === user?.id;
                return (
                  <div key={msg.id} className={`flex mb-2.5 gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
                    {!isMine && (
                      <div className="w-8 h-8 rounded-full bg-secondary text-foreground/70 flex items-center justify-center text-[11px] font-semibold shrink-0 mt-1">
                        {initials(msg.sender_name)}
                      </div>
                    )}
                    <div className={`max-w-[78%] sm:max-w-[65%] rounded-2xl px-4 py-2.5 ${
                      isMine
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-secondary text-foreground rounded-bl-md'
                    }`}>
                      {!isMine && (
                        <p className="text-xs font-semibold text-blue-500 mb-0.5">{msg.sender_name}</p>
                      )}
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                      <p className={`text-[11px] mt-1 text-right ${isMine ? 'text-blue-100/80' : 'text-muted-foreground'}`}>
                        {formatTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-card border-t border-border p-3 sm:p-4 shrink-0">
        <div className="flex items-end gap-2 sm:gap-3">
          <textarea
            ref={textareaRef}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            autoFocus
            className="flex-1 bg-secondary border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-none text-base max-h-32"
            placeholder="Написать сообщение..."
          />
          <button
            onClick={handleSendMessage}
            disabled={!newMessage.trim() || sending}
            className="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            aria-label="Отправить"
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}