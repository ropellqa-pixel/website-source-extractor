import { db } from '@/lib/sdk';

/** Генерирует 6-значный код привязки. */
function generateBindCode(): string {
  let result = '';
  for (let i = 0; i < 6; i++) result += Math.floor(Math.random() * 10).toString();
  return result;
}

/** Создаёт новый код привязки для профиля. Возвращает код или null. */
export async function createVkBindCode(profileId: string): Promise<string | null> {
  // Удаляем старые pending коды этого профиля
  await db.from('vk_bind_codes').delete().eq('profile_id', profileId).eq('status', 'pending');

  // Генерируем уникальный код
  let code = generateBindCode();
  let attempts = 0;
  while (attempts < 50) {
    const { data } = await db.from('vk_bind_codes').select('id').eq('code', code).limit(1);
    if (!data || data.length === 0) break;
    code = generateBindCode();
    attempts++;
  }

  const { error } = await db.from('vk_bind_codes').insert({
    profile_id: profileId,
    code,
    status: 'pending',
  });
  if (error) {
    console.error('[VkBind] insert error:', error);
    return null;
  }
  return code;
}

/** Проверяет, есть ли активный код для профиля. */
export async function getVkBindCode(profileId: string): Promise<string | null> {
  const { data, error } = await db.from('vk_bind_codes')
    .select('code, status')
    .eq('profile_id', profileId)
    .eq('status', 'pending')
    .limit(1);
  if (error || !data?.length) return null;
  return data[0].code;
}

/** Сохраняет ссылку VK и существующую заявку как одну логическую операцию. */
export async function updateVkProfileLink(profileId: string, vkLink: string, requestBinding = false): Promise<void> {
  const { data: profiles, error: profileReadError } = await db.from('profiles')
    .select('id, vk_link, vk_id').eq('id', profileId).limit(1);
  if (profileReadError) throw profileReadError;
  if (!profiles?.length) throw new Error('Профиль не найден');
  const profile = profiles[0];

  const { data: bindings, error: bindingReadError } = await db.from('vk_bindings')
    .select('id, vk_link, status').eq('profile_id', profileId).limit(1);
  if (bindingReadError) throw bindingReadError;
  const binding = bindings?.[0];
  const bindingLinkChanged = !!binding && binding.vk_link !== vkLink;
  const waitingMessage = 'Ожидание привязки по коду';

  if (binding) {
    if (bindingLinkChanged) {
      const { error } = await db.from('vk_bindings').update({
        vk_link: vkLink, vk_user_id: null, status: 'pending', message: waitingMessage,
      }).eq('id', binding.id);
      if (error) throw error;
    } else if (requestBinding && !profile.vk_id && binding.status !== 'pending') {
      const { error } = await db.from('vk_bindings').update({
        status: 'pending', message: waitingMessage,
      }).eq('id', binding.id);
      if (error) throw error;
    }
  } else if (requestBinding) {
    const { error } = await db.from('vk_bindings').insert({
      profile_id: profileId, vk_link: vkLink, status: 'pending', message: waitingMessage,
    });
    if (error) throw error;
  }

  const profileLinkChanged = profile.vk_link !== vkLink;
  const { error: profileWriteError } = await db.from('profiles').update({
    vk_link: vkLink,
    ...(profileLinkChanged || bindingLinkChanged ? { vk_id: null } : {}),
  }).eq('id', profileId);
  if (profileWriteError) throw profileWriteError;
}
