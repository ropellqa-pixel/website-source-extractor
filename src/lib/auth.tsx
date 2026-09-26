import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { auth, db } from '@/lib/sdk';

export type UserRole = 'director' | 'deputy_director' | 'senior_employee' | 'employee';

export interface User {
  id: string;
  email: string;
  login: string;
  role: UserRole;
  companyId: string;
  companyName: string;
  fullName: string;
  profileId?: string;
  department?: string;
  inn?: string;
  ogrn?: string;
}

export interface Company {
  id: string;
  name: string;
  inn: string;
  ogrn: string;
  type: 'ИП' | 'ООО';
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  company: Company | null;
  loading: boolean;
  signUp: (data: {
    email: string; password: string; fullName: string;
    companyName: string; inn: string; ogrn: string;
    companyType: 'ИП' | 'ООО';
  }) => Promise<{ needsEmailConfirmation?: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshRoles: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Определяем роль пользователя.
 * 1. Если пользователь — admin в Lork Auth → director (это владелец аккаунта платформы)
 * 2. Иначе ищем профиль по user_id (надёжнее email) в таблице profiles
 * 3. Fallback: поиск по email (независимо от регистра)
 * 4. Если профиль не найден → employee (безопасный fallback)
 */
async function resolveUserRole(authEmail: string, authUserId: string): Promise<{ role: UserRole; fullName: string; profileId: string; department: string }> {
  // Проверяем auth admin роль — владелец платформы всегда director
  try {
    const roles = await auth.getRoles();
    if (roles.includes('admin')) {
      // Владелец платформы — director. Ищем профиль для fullName и department
      const { data } = await db
        .from('profiles')
        .select('id, full_name, department')
        .eq('email', authEmail)
        .limit(1);
      if (data && data.length > 0) {
        return { role: 'director', fullName: data[0].full_name || '', profileId: data[0].id, department: data[0].department || '' };
      }
      return { role: 'director', fullName: '', profileId: '', department: '' };
    }
  } catch (e) {
    console.error('Auth roles check error:', e);
  }

  // Не admin — ищем профиль: сначала по user_id (надёжно), затем по email (fallback)
  let profile = null;

  // 1. Поиск по user_id — самый надёжный способ
  if (authUserId) {
    const { data } = await db
      .from('profiles')
      .select('id, role, full_name, department')
      .eq('user_id', authUserId)
      .limit(1);
    if (data && data.length > 0) profile = data[0];
  }

  // 2. Fallback: поиск по email
  if (!profile) {
    const { data, error } = await db
      .from('profiles')
      .select('id, role, full_name, department')
      .eq('email', authEmail)
      .limit(1);
    if (error) {
      console.error('resolveUserRole query error:', error);
    }
    if (data && data.length > 0) profile = data[0];
  }

  if (profile) {
    const validRoles: UserRole[] = ['director', 'deputy_director', 'senior_employee', 'employee'];
    const role = validRoles.includes(profile.role as UserRole) ? (profile.role as UserRole) : 'employee';
    return { role, fullName: profile.full_name || '', profileId: profile.id, department: profile.department || '' };
  }

  return { role: 'employee', fullName: '', profileId: '', department: '' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedCredentials, setSavedCredentials] = useState<{ email: string; password: string } | null>(null);

  const buildUser = useCallback(async (authUser: any): Promise<User | null> => {
    if (!authUser) return null;

    const userId = authUser.id;
    const email = authUser.email || '';

    const savedCompany = localStorage.getItem('biz_company');
    const parsedCompany = savedCompany ? JSON.parse(savedCompany) : null;
    const { role, fullName, profileId, department } = await resolveUserRole(email, userId);

    return {
      id: userId,
      email,
      login: email.split('@')[0] || '',
      role,
      companyId: parsedCompany?.id || '',
      companyName: parsedCompany?.name || '',
      fullName,
      profileId,
      department,
      inn: parsedCompany?.inn || undefined,
      ogrn: parsedCompany?.ogrn || undefined,
    };
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const session = await auth.getSession();
        if (session?.user) {
          const u = await buildUser(session.user);
          setUser(u);
          const savedCompany = localStorage.getItem('biz_company');
          if (savedCompany) setCompany(JSON.parse(savedCompany));
        }
      } catch (e) {
        console.error('Auth init error:', e);
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, [buildUser]);

  const signUp = async (data: {
    email: string; password: string; fullName: string;
    companyName: string; inn: string; ogrn: string;
    companyType: 'ИП' | 'ООО';
  }) => {
    const result = await auth.signUpWithPassword({
      email: data.email,
      password: data.password,
    });

    const companyId = 'comp_' + Date.now();
    const c: Company = {
      id: companyId, name: data.companyName, inn: data.inn,
      ogrn: data.ogrn, type: data.companyType, createdAt: new Date().toISOString(),
    };
    localStorage.setItem('biz_company', JSON.stringify(c));

    if (result.needs_email_confirmation) {
      return { needsEmailConfirmation: true };
    }

    const userId = result.user?.id;

    // Создаём профиль директора в БД
    if (userId) {
      try {
        const { error: profileErr } = await db.from('profiles').insert({
          user_id: userId,
          full_name: data.fullName,
          email: data.email,
          role: 'director',
          department: 'Руководство',
          status: 'active',
          has_system_access: true,
        }).select();
        if (profileErr) {
          console.error('Failed to create director profile:', profileErr);
        }
      } catch (e) {
        console.error('Director profile creation error:', e);
      }
    }

    const u: User = {
      id: userId || 'unknown',
      email: data.email,
      login: data.email.split('@')[0],
      role: 'director',
      companyId,
      companyName: data.companyName,
      fullName: data.fullName,
      department: 'Руководство',
      inn: data.inn,
      ogrn: data.ogrn,
    };
    setUser(u);
    setCompany(c);
    setSavedCredentials({ email: data.email, password: data.password });

    return {};
  };

  const signIn = async (email: string, password: string) => {
    const result = await auth.signInWithPassword({ email, password });

    if (!result.user) {
      throw new Error('Не удалось войти. Проверьте email и пароль.');
    }

    const u = await buildUser(result.user);
    setUser(u);
    const savedCompany = localStorage.getItem('biz_company');
    if (savedCompany) setCompany(JSON.parse(savedCompany));
    setSavedCredentials({ email, password });
  };

  const signOut = async () => {
    await auth.signOut();
    localStorage.removeItem('biz_pin_match');
    setUser(null);
    setCompany(null);
    setSavedCredentials(null);
  };

  const refreshUser = async () => {
    const session = await auth.getSession();
    if (session?.user) {
      const u = await buildUser(session.user);
      setUser(u);
    }
  };

  const refreshRoles = async (): Promise<boolean> => {
    try {
      const roles = await auth.getRoles();
      return roles.includes('admin');
    } catch (err) {
      console.error('Refresh roles error:', err);
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ user, company, loading, signUp, signIn, signOut, refreshUser, refreshRoles }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
