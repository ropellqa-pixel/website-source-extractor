import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/auth';
import { db } from '@/lib/sdk';
import {
  MessageSquare, Send, Search, Users, User,
  MoreVertical, Bell, BellOff, Plus, X, Check, CheckCheck
} from 'lucide-react';

interface ChatRoom {
  id: string;
  name: string;
  type: 'group' | 'private';
  participants: string[];
  created_at: string;
}

interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  read: boolean;
  created_at: string;
}

export default function Chat() {
  const { user } = useAuth();
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRooms = useCallback(async () => {
    try {
      const { data, error } = await db.from('chat_rooms').select('*').order('created_at', { ascending: false });
      if (!error && data) setChatRooms(data);
    } catch { /* таблица может не существовать */ }
  }, []);

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
    const init = async () => {
      setLoading(true);
      await loadRooms();
      setLoading(false);
    };
    init();
  }, [loadRooms]);

  useEffect(() => {
    if (selectedChat) {
      loadMessages(selectedChat.id);
    }
  }, [selectedChat, loadMessages]);

  // Polling new messages every 5s when chat selected
  useEffect(() => {
    if (selectedChat) {
      pollRef.current = setInterval(() => loadMessages(selectedChat.id), 5000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [selectedChat, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const filteredRooms = chatRooms.filter(r =>
    r.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChat || !user) return;
    setSending(true);
    try {
      const { data, error } = await db.from('chat_messages').insert({
        room_id: selectedChat.id,
        sender_id: user.id,
        sender_name: user.fullName || 'Пользователь',
        content: newMessage.trim(),
        read: false,
      }).select().single();
      if (!error && data) {
        setMessages(prev => [...prev, data]);
        setNewMessage('');
      }
    } catch { /* */ }
    setSending(false);
  };

  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) return;
    try {
      const { data, error } = await db.from('chat_rooms').insert({
        name: newRoomName.trim(),
        type: 'group',
        participants: user ? [user.id] : [],
      }).select().single();
      if (!error && data) {
        setChatRooms(prev => [data, ...prev]);
        setSelectedChat(data);
      }
    } catch { /* */ }
    setNewRoomName('');
    setShowNewRoom(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (iso: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  const lastMessage = (room: ChatRoom) => {
    // Use messages from selected room or placeholder
    return '';
  };

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-80 bg-card border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <MessageSquare className="w-6 h-6" />
              Чат
            </h1>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowNewRoom(true)}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                title="Новый чат"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
              placeholder="Поиск чатов..."
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-muted-foreground">Загрузка...</div>
          ) : filteredRooms.length === 0 ? (
            <div className="p-6 text-center">
              <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">Чатов пока нет</p>
              <button onClick={() => setShowNewRoom(true)} className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium">
                Создать чат
              </button>
            </div>
          ) : (
            filteredRooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setSelectedChat(room)}
                className={`w-full p-4 text-left transition-all border-b border-border ${
                  selectedChat?.id === room.id
                    ? 'bg-blue-500/10 border-l-2 border-l-blue-500'
                    : 'hover:bg-secondary border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    room.type === 'group'
                      ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                      : 'bg-gradient-to-br from-emerald-500 to-emerald-600'
                  }`}>
                    {room.type === 'group' ? <Users className="w-6 h-6 text-foreground" /> : <User className="w-6 h-6 text-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground truncate">{room.name}</h3>
                    <p className="text-xs text-muted-foreground">{room.type === 'group' ? 'Групповой' : 'Личный'}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      {selectedChat ? (
        <div className="flex-1 flex flex-col">
          {/* Chat Header */}
          <div className="bg-card backdrop-blur-sm border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                selectedChat.type === 'group'
                  ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                  : 'bg-gradient-to-br from-emerald-500 to-emerald-600'
              }`}>
                {selectedChat.type === 'group' ? <Users className="w-5 h-5 text-foreground" /> : <User className="w-5 h-5 text-foreground" />}
              </div>
              <div>
                <h2 className="font-semibold text-foreground">{selectedChat.name}</h2>
                <p className="text-xs text-muted-foreground">Создан: {selectedChat.created_at?.split('T')[0]}</p>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center h-full">
                <p className="text-muted-foreground">Нет сообщений. Начните переписку!</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[70%] ${
                    msg.sender_id === user?.id
                      ? 'bg-blue-500 text-white'
                      : 'bg-secondary text-foreground'
                  } rounded-2xl px-4 py-3`}>
                    {msg.sender_id !== user?.id && selectedChat.type === 'group' && (
                      <p className="text-xs font-medium text-blue-600 mb-1">{msg.sender_name}</p>
                    )}
                    <p className="text-sm">{msg.content}</p>
                    <p className={`text-xs mt-1 ${msg.sender_id === user?.id ? 'text-blue-800' : 'text-muted-foreground'}`}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input */}
          <div className="bg-card border-t border-border p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyPress}
                  rows={1}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-none text-base"
                  placeholder="Введите сообщение..."
                />
              </div>
              <button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || sending}
                className="bg-blue-500 text-white p-3 rounded-xl hover:bg-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <MessageSquare className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Выберите чат</h2>
            <p className="text-muted-foreground">Выберите чат из списка или создайте новый</p>
          </div>
        </div>
      )}

      {/* Модалка создания чата */}
      {showNewRoom && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md border border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-foreground">Новый чат</h2>
              <button onClick={() => setShowNewRoom(false)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base mb-4"
              placeholder="Название чата"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateRoom()}
            />
            <div className="flex gap-3">
              <button
                onClick={handleCreateRoom}
                disabled={!newRoomName.trim()}
                className="flex-1 bg-blue-500 text-white py-2 rounded-lg font-medium hover:bg-blue-600 transition-all disabled:opacity-50"
              >
                Создать
              </button>
              <button
                onClick={() => { setShowNewRoom(false); setNewRoomName(''); }}
                className="flex-1 bg-secondary text-foreground py-2 rounded-lg font-medium hover:bg-border transition-all"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
