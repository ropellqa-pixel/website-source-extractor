import { Dispatch, SetStateAction } from 'react';
import {
  User, Building2, Save, Mail, Phone, KeyRound, Eye, EyeOff, RefreshCw, Copy, Check, Link,
} from 'lucide-react';
import type { PinCode } from './types';

interface Props {
  activeTab: string;
  profileData: { fullName: string; email: string; phone: string };
  setProfileData: Dispatch<SetStateAction<{ fullName: string; email: string; phone: string }>>;
  companyData: { name: string; inn: string; ogrn: string; type: 'ИП' | 'ООО' };
  setCompanyData: Dispatch<SetStateAction<{ name: string; inn: string; ogrn: string; type: 'ИП' | 'ООО' }>>;
  saved: boolean;
  handleSaveProfile: () => void;
  vkError: string;
  vkLinked: boolean;
  vkLink: string;
  vkBindCode: string | null;
  vkBindingLoading: boolean;
  handleGenerateVkCode: () => void;
  handleUnbindOwnVk: () => void;
  pins: PinCode[];
  isDirector: boolean;
  pinLoading: boolean;
  handleCreateDirectorPin: () => void;
  showPin: string | null;
  setShowPin: Dispatch<SetStateAction<string | null>>;
  copiedId: string | null;
  copyToClipboard: (text: string, id: string) => void;
  DIRECTOR_PIN: string;
}

export default function SettingsAccountTabs({
  activeTab, profileData, setProfileData, companyData, setCompanyData, saved, handleSaveProfile,
  vkError, vkLinked, vkLink, vkBindCode, vkBindingLoading, handleGenerateVkCode, handleUnbindOwnVk,
  pins, isDirector, pinLoading, handleCreateDirectorPin, showPin, setShowPin, copiedId, copyToClipboard, DIRECTOR_PIN,
}: Props) {
  return (
    <>
      {activeTab === 'profile' && (
        <div className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-6">Настройки профиля</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">ФИО</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input type="text" value={profileData.fullName}
                    onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                    className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input type="email" value={profileData.email}
                    onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                    className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Телефон</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input type="tel" value={profileData.phone}
                    onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                    placeholder="+7 (999) 123-45-67" />
                </div>
              </div>
            </div>
            <button onClick={handleSaveProfile} className="mt-6 bg-blue-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-600 transition-all flex items-center gap-2">
              <Save className="w-5 h-5" />
              {saved ? 'Сохранено!' : 'Сохранить'}
            </button>
          </div>

          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
              <Link className="w-5 h-5 text-blue-600" />
              Привязка VK
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Привяжите VK, чтобы получать табель и расчёт зарплаты сообщением от бота.
            </p>
            {vkError && (
              <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-xs text-red-600">{vkError}</p>
              </div>
            )}
            {vkLinked ? (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2">
                  <Check className="w-5 h-5 text-emerald-600 shrink-0" />
                  <p className="text-sm text-emerald-600 font-medium">VK привязан{vkLink ? ` (${vkLink})` : ''}</p>
                </div>
                <button onClick={handleUnbindOwnVk}
                  className="w-full py-2 border border-red-500/30 rounded-lg text-sm text-red-600 hover:bg-red-500/10 transition-all">
                  Отвязать VK
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {vkBindCode ? (
                  <div className="p-4 bg-secondary rounded-lg border border-blue-500/30 text-center">
                    <p className="text-xs text-muted-foreground mb-2">Код привязки</p>
                    <p className="font-mono text-3xl text-blue-600 tracking-widest font-bold">{vkBindCode}</p>
                    <p className="text-xs text-muted-foreground mt-2">Отправьте этот код боту АнодБИЗ ВКонтакте</p>
                  </div>
                ) : (
                  <div className="p-3 bg-secondary rounded-lg border border-border text-center">
                    <p className="text-xs text-muted-foreground">Нажмите «Получить код» — придёт 6-значный код для отправки боту</p>
                  </div>
                )}
                <button onClick={handleGenerateVkCode} disabled={vkBindingLoading}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                  <RefreshCw className="w-4 h-4" />
                  {vkBindingLoading ? 'Создание...' : vkBindCode ? 'Новый код' : 'Получить код'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'company' && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-6">Данные компании</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Название организации</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input type="text" value={companyData.name}
                  onChange={(e) => setCompanyData({ ...companyData, name: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">ИНН</label>
                <input type="text" value={companyData.inn}
                  onChange={(e) => setCompanyData({ ...companyData, inn: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">ОГРН</label>
                <input type="text" value={companyData.ogrn}
                  onChange={(e) => setCompanyData({ ...companyData, ogrn: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
              </div>
            </div>
          </div>
          <button onClick={handleSaveProfile} className="mt-6 bg-blue-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-600 transition-all flex items-center gap-2">
            <Save className="w-5 h-5" />
            {saved ? 'Сохранено!' : 'Сохранить'}
          </button>
        </div>
      )}

      {activeTab === 'quicklogin' && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Быстрый вход по пин-коду</h2>
          <p className="text-sm text-muted-foreground mb-6">Ваш пин-код для быстрого входа.</p>
          {pins.length === 0 ? (
            <div className="text-center py-8">
              <KeyRound className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-4">Пин-код не назначен</p>
              {isDirector ? (
                <button onClick={handleCreateDirectorPin} disabled={pinLoading}
                  className="bg-gradient-to-r from-amber-500 to-orange-600 text-white px-6 py-3 rounded-lg font-medium hover:from-amber-600 hover:to-orange-700 transition-all flex items-center gap-2 mx-auto disabled:opacity-50">
                  <KeyRound className="w-5 h-5" />
                  {pinLoading ? 'Создание...' : `Создать мой пин (${DIRECTOR_PIN})`}
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">Обратитесь к руководителю для назначения пин-кода</p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {pins.map(pinEntry => (
                <div key={pinEntry.id} className="bg-secondary rounded-lg p-4 border border-border">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <KeyRound className="w-4 h-4 text-amber-600" />
                      <span className="font-mono text-xl text-foreground tracking-widest">
                        {showPin === pinEntry.id ? pinEntry.pin : '••••'}
                      </span>
                      <button onClick={() => setShowPin(showPin === pinEntry.id ? null : pinEntry.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors">
                        {showPin === pinEntry.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button onClick={() => copyToClipboard(pinEntry.pin, `setting-pin-${pinEntry.id}`)}
                        className="text-muted-foreground hover:text-foreground transition-colors" title="Копировать">
                        {copiedId === `setting-pin-${pinEntry.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {isDirector && (
                <button onClick={handleCreateDirectorPin} disabled={pinLoading}
                  className="w-full py-2 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-amber-600 hover:border-amber-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                  <RefreshCw className="w-4 h-4" />
                  {pinLoading ? 'Обновление...' : `Обновить пин на ${DIRECTOR_PIN}`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

    </>
  );
}
