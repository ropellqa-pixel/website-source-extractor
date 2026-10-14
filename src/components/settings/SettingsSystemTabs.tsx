import { Dispatch, SetStateAction } from 'react';
import { Lock, Eye, EyeOff, RefreshCw, Copy, Check, Monitor } from 'lucide-react';

interface Props {
  activeTab: string;
  notifications: { email: boolean; push: boolean; chat: boolean; documents: boolean };
  setNotifications: Dispatch<SetStateAction<{ email: boolean; push: boolean; chat: boolean; documents: boolean }>>;
  apiTokenLoading: boolean;
  apiToken: string | null;
  apiTokenVisible: boolean;
  setApiTokenVisible: Dispatch<SetStateAction<boolean>>;
  copiedId: string | null;
  copyToClipboard: (text: string, id: string) => void;
  setShowRevokeConfirm: Dispatch<SetStateAction<boolean>>;
}

export default function SettingsSystemTabs({
  activeTab, notifications, setNotifications, apiTokenLoading, apiToken, apiTokenVisible, setApiTokenVisible,
  copiedId, copyToClipboard, setShowRevokeConfirm,
}: Props) {
  return (
    <>
      {activeTab === 'notifications' && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-6">Настройки уведомлений</h2>
          <div className="space-y-4">
            {Object.entries(notifications).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between p-4 bg-secondary rounded-lg">
                <div>
                  <p className="font-medium text-foreground">{key === 'email' ? 'Email' : key === 'push' ? 'Push' : key === 'chat' ? 'Чат' : 'Документы'}</p>
                </div>
                <button onClick={() => setNotifications({ ...notifications, [key]: !value })}
                  className={`w-12 h-6 rounded-full transition-all ${value ? 'bg-blue-500' : 'bg-muted'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full transition-all ${value ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-6">Безопасность</h2>
          <div className="p-4 bg-secondary rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <Lock className="w-5 h-5 text-amber-600" />
              <h3 className="font-medium text-foreground">Изменить пароль</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Рекомендуем регулярно менять пароль.</p>
            <div className="space-y-3">
              <input type="password" className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" placeholder="Текущий пароль" />
              <input type="password" className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" placeholder="Новый пароль" />
              <input type="password" className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" placeholder="Подтвердите" />
            </div>
          </div>

          <div className="p-4 bg-secondary rounded-lg mt-4">
            <div className="flex items-center gap-3 mb-2">
              <Monitor className="w-5 h-5 text-blue-600" />
              <h3 className="font-medium text-foreground">Доступ для десктоп-приложения</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Постоянный личный ключ для подключения твоей программы (C#/WPF) напрямую к серверу —
              без входа через браузер. Вставь его в настройки приложения один раз.
            </p>

            {apiTokenLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            ) : apiToken ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <input
                    readOnly
                    type={apiTokenVisible ? 'text' : 'password'}
                    value={apiToken}
                    className="flex-1 bg-card border border-border rounded-lg px-4 py-3 text-foreground font-mono text-sm focus:outline-none"
                  />
                  <button
                    onClick={() => setApiTokenVisible(v => !v)}
                    className="p-3 bg-card border border-border rounded-lg text-muted-foreground hover:text-foreground transition-all"
                    title={apiTokenVisible ? 'Скрыть' : 'Показать'}
                  >
                    {apiTokenVisible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => copyToClipboard(apiToken, 'api-token')}
                    className="p-3 bg-card border border-border rounded-lg text-muted-foreground hover:text-foreground transition-all"
                    title="Скопировать"
                  >
                    {copiedId === 'api-token' ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
                <button
                  onClick={() => setShowRevokeConfirm(true)}
                  className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  <RefreshCw className="w-4 h-4" />
                  Отозвать и выпустить новый ключ
                </button>
                <p className="text-xs text-muted-foreground mt-2">
                  Отзывай ключ, только если он попал не в те руки — старые подключения программы сразу перестанут работать.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Не удалось получить ключ. Обновите страницу.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
