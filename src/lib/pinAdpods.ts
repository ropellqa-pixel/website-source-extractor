/**
 * Адресные поддомены (АдПод) для быстрого входа по ПИН-коду.
 * Каждый сотрудник при создании пин-кода привязывается ровно к одному АдПоду —
 * изменить привязку нельзя, только сгенерировать новый пин-код (снова с выбором АдПода).
 * На страницах АдПодов доступен только вход по ПИН-коду (без пароля/логина).
 */
export interface PinAdpod {
  slug: string;
  label: string;
  path: string;
}

export const PIN_ADPODS: PinAdpod[] = [
  {
    slug: 'pin-cod-sallet-inword-okredfit-offsdin',
    label: 'АдПод 1',
    path: '/pin-cod-sallet-inword-okredfit-offsdin',
  },
  {
    slug: 'pin-cod-tutokenswe-ruidfal-manu-direst',
    label: 'АдПод 2',
    path: '/pin-cod-tutokenswe-ruidfal-manu-direst',
  },
  {
    slug: 'pin-cod-famolderreg-hoocind-injoorenaz',
    label: 'АдПод 3',
    path: '/pin-cod-famolderreg-hoocind-injoorenaz',
  },
];

export function getAdpodBySlug(slug: string | null | undefined): PinAdpod | undefined {
  if (!slug) return undefined;
  return PIN_ADPODS.find(a => a.slug === slug);
}
