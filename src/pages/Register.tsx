import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Building2, User, Mail, Lock, FileText, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import AnodBizLogo from '../components/AnodBizLogo';

interface FormData {
  companyType: 'ИП' | 'ООО';
  companyName: string;
  inn: string;
  ogrn: string;
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export default function Register() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData>({
    companyType: 'ООО',
    companyName: '',
    inn: '',
    ogrn: '',
    fullName: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const updateField = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateStep1 = () => {
    if (!formData.companyName.trim()) return 'Введите название компании';
    if (!formData.inn.trim()) return 'Введите ИНН';
    if (formData.inn.length !== 10 && formData.inn.length !== 12) return 'ИНН должен содержать 10 или 12 цифр';
    if (!formData.ogrn.trim()) return 'Введите ОГРН';
    if (formData.ogrn.length !== 13 && formData.ogrn.length !== 15) return 'ОГРН должен содержать 13 или 15 цифр';
    return null;
  };

  const validateStep2 = () => {
    if (!formData.fullName.trim()) return 'Введите ФИО руководителя';
    if (!formData.email.trim()) return 'Введите email';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Введите корректный email';
    if (!formData.password) return 'Придумайте пароль';
    if (formData.password.length < 6) return 'Пароль должен содержать минимум 6 символов';
    if (formData.password !== formData.confirmPassword) return 'Пароли не совпадают';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (step === 1) {
      const validationError = validateStep1();
      if (validationError) { setError(validationError); return; }
      setStep(2);
      return;
    }

    const validationError = validateStep2();
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      const result = await signUp({
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
        companyName: formData.companyName,
        inn: formData.inn,
        ogrn: formData.ogrn,
        companyType: formData.companyType
      });

      if (result.needsEmailConfirmation) {
        setSuccess(true);
        return;
      }

      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl shadow-lg mb-4">
              <Check className="w-10 h-10 text-foreground" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Регистрация завершена</h1>
          </div>
          <div className="bg-card backdrop-blur-sm rounded-[22px] shadow-[0_30px_60px_-30px_hsl(var(--logo-2)/0.25)] p-8 border border-border text-center">
            <p className="text-foreground/80 mb-6">
              Письмо с подтверждением отправлено на <strong className="text-foreground">{formData.email}</strong>. 
              Пожалуйста, перейдите по ссылке в письме для подтверждения email.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="w-full bg-primary text-white font-medium py-3 px-4 rounded-lg hover:bg-primary/85 transition-all"
            >
              Перейти к входу
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <AnodBizLogo size="lg" />
          <h1 className="text-3xl font-bold text-foreground mb-2 mt-4">АнодБИЗ</h1>
          <p className="text-muted-foreground">Регистрация компании</p>
        </div>

        <div className="bg-card backdrop-blur-sm rounded-[22px] shadow-[0_30px_60px_-30px_hsl(var(--logo-2)/0.25)] p-8 border border-border">
          <div className="flex items-center justify-center mb-8">
            <div className="flex items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${step >= 1 ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'}`}>
                {step > 1 ? <Check className="w-5 h-5" /> : '1'}
              </div>
              <div className={`w-24 h-1 mx-2 ${step >= 2 ? 'bg-blue-500' : 'bg-muted'}`} />
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${step >= 2 ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'}`}>
                2
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {step === 1 ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">Тип организации</label>
                  <div className="flex gap-3">
                    {['ООО', 'ИП'].map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => updateField('companyType', type as 'ИП' | 'ООО')}
                        className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                          formData.companyType === type
                            ? 'bg-blue-500 text-white'
                            : 'bg-secondary text-foreground/80 hover:bg-border'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">Название организации</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type="text"
                      value={formData.companyName}
                      onChange={(e) => updateField('companyName', e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                      placeholder="ООО «Компания»"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">ИНН</label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type="text"
                      value={formData.inn}
                      onChange={(e) => updateField('inn', e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                      placeholder="10 или 12 цифр"
                      maxLength={12}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">ОГРН</label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type="text"
                      value={formData.ogrn}
                      onChange={(e) => updateField('ogrn', e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                      placeholder="13 или 15 цифр"
                      maxLength={15}
                      required
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">ФИО руководителя</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type="text"
                      value={formData.fullName}
                      onChange={(e) => updateField('fullName', e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                      placeholder="Иванов Иван Иванович"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => updateField('email', e.target.value)}
                      className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                      placeholder="email@company.ru"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Пароль</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => updateField('password', e.target.value)}
                        className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                        placeholder="Минимум 6 символов"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Подтвердите пароль</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <input
                        type="password"
                        value={formData.confirmPassword}
                        onChange={(e) => updateField('confirmPassword', e.target.value)}
                        className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
                        placeholder="Повторите пароль"
                        required
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-3 pt-4">
              {step === 2 && (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 bg-secondary text-foreground/80 font-medium py-3 px-4 rounded-lg hover:bg-border transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-5 h-5" />
                  Назад
                </button>
              )}
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-primary text-white font-medium py-3 px-4 rounded-lg hover:bg-primary/85 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? 'Регистрация...' : step === 1 ? 'Далее' : 'Зарегистрироваться'}
                {!loading && (step === 1 ? <ArrowRight className="w-5 h-5" /> : <Check className="w-5 h-5" />)}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground">
              Уже есть аккаунт?{' '}
              <a href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
                Войти
              </a>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center text-muted-foreground text-sm">
          © 2026 АнодБИЗ. Все права защищены.
        </div>
      </div>
    </div>
  );
}