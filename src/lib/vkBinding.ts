import { db } from '@/lib/sdk';
import { apiUrl } from '@/lib/apiUrls';

const VK_API_URL = apiUrl('vk-api');

interface VkStatusResponse {
  code: string | null;
  binding: {
    vk_user_id: number | null;
    vk_link: string | null;
    status: string;
    message: string | null;
  } | null;
}

/** Создаёт новый код привязки для профиля на сервере. Возвращает код или null. */
export async function createVkBindCode(profileId: string): Promise<string | null> {
  try {
    const res = await fetch(VK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate_code', profile_id: profileId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.code || null;
  } catch (e) {
    console.error('[VkBind] generate_code error:', e);
    return null;
  }
}

/** Проверяет, есть ли активный код для профиля, и статус привязки. */
export async function getVkBindCode(profileId: string): Promise<string | null> {
  try {
    const res = await fetch(`${VK_API_URL}?action=status&profile_id=${encodeURIComponent(profileId)}`);
    if (!res.ok) return null;
    const data: VkStatusResponse = await res.json();
    return data.code || null;
  } catch (e) {
    console.error('[VkBind] status error:', e);
    return null;
  }
}

/** Полный статус привязки (код + подтверждённая привязка), для страницы Сотрудники. */
export async function getVkStatus(profileId: string): Promise<VkStatusResponse | null> {
  try {
    const res = await fetch(`${VK_API_URL}?action=status&profile_id=${encodeURIComponent(profileId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('[VkBind] status error:', e);
    return null;
  }
}

/** Возвращает все подтверждённые привязки VK разом: { profile_id -> vk_user_id }. Используется для рассылок. */
export async function getAllVkBindings(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${VK_API_URL}?action=bindings_list`);
    if (!res.ok) return {};
    const data = await res.json();
    const map: Record<string, string> = {};
    (data.bindings || []).forEach((b: { profile_id: string; vk_user_id: number }) => {
      map[b.profile_id] = String(b.vk_user_id);
    });
    return map;
  } catch (e) {
    console.error('[VkBind] bindings_list error:', e);
    return {};
  }
}

/** Отвязывает VK на сервере и очищает ссылку в профиле. */
export async function unbindVk(profileId: string): Promise<void> {
  await fetch(VK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'unbind', profile_id: profileId }),
  });
  await db.from('profiles').update({ vk_link: null, vk_id: null }).eq('id', profileId);
}

/** Сохраняет ссылку VK в профиле (сам факт привязки подтверждает бот по коду). */
export async function updateVkProfileLink(profileId: string, vkLink: string): Promise<void> {
  const { error } = await db.from('profiles').update({ vk_link: vkLink }).eq('id', profileId);
  if (error) throw error;
}