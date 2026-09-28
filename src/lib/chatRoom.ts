import { db } from '@/lib/sdk';

export const WORKING_CHAT_NAME = 'РАБОЧИЙ';

export interface ChatRoom {
  id: string;
  name: string;
  type: string;
  participants: string[];
  created_at: string;
}

/** Возвращает единственный общий рабочий чат. Если его вдруг нет — создаёт. */
export async function ensureWorkingRoom(): Promise<ChatRoom | null> {
  const { data } = await db.from('chat_rooms').select('*').eq('name', WORKING_CHAT_NAME).limit(1);
  if (data && data.length > 0) return data[0] as ChatRoom;

  const { data: created, error } = await db.from('chat_rooms').insert({
    name: WORKING_CHAT_NAME,
    type: 'group',
    participants: [],
  }).select().single();
  if (error || !created) return null;
  return created as ChatRoom;
}