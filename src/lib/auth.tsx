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
  signInWithPin: (pin: string, adpodSlug: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshRoles: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Компания хранится в реальной БД (одна запись с id='main' — система для одной компании). */
async function loadCompany(): Promise<Company | null> {
  const { data } = await db.from('companies').select('*').eq('id', 'main').maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name || '',
    inn: data.inn || '',
    ogrn: data.ogrn || '',
    type: (data.type as 'ИП' | 'ООО') || 'ООО',
    createdAt: data.created_at || '',
  };
}

/**
 * Определяем роль пользователя.
 * 1. Если пользователь — admin (первый зарегистрированный) → director
 * 2. Иначе ищем профиль по user_id (надёжнее email) в таблице profiles
 * 3. Fallback: поиск по email (независимо от регистра)
 * 4. Если профиль не найден → employee (безопасный fallback)
 */
async function resolveUserRole(authEmail: string, authUserId: string): Promise<{ role: UserRole; fullName: string; profileId: string; department: string }> {
  try {
    const roles = await auth.getRoles();
    if (roles.includes('admin')) {
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

  let profile = null;

  if (authUserId) {
    const { data } = await db
      .from('profiles')
      .select('id, role, full_name, department')
      .eq('user_id', authUserId)
      .limit(1);
    if (data && data.length > 0) profile = data[0];
  }

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

  const buildUser = useCallback(async (authUser: any, existingCompany?: Company | null): Promise<User | null> => {
    if (!authUser) return null;

    const userId = authUser.id;
    const email = authUser.email || '';

    const comp = existingCompany !== undefined ? existingCompany : await loadCompany();
    const { role, fullName, profileId, department } = await resolveUserRole(email, userId);

    return {
      id: userId,
      email,
      login: email.split('@')[0] || '',
      role,
      companyId: comp?.id || '',
      companyName: comp?.name || '',
      fullName,
      profileId,
      department,
      inn: comp?.inn || undefined,
      ogrn: comp?.ogrn || undefined,
    };
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const session = await auth.getSession();
        if (session?.user) {
          const comp = await loadCompany();
          setCompany(comp);
          const u = await buildUser(session.user, comp);
          setUser(u);
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

    if (result.needs_email_confirmation) {
      return { needsEmailConfirmation: true };
    }

    const userId = result.user?.id;

    // Компания хранится в БД — одна запись 'main' на всю систему
    const { data: existingCompany } = await db.from('companies').select('id').eq('id', 'main').maybeSingle();
    if (existingCompany) {
      await db.from('companies').update({
        name: data.companyName, inn: data.inn, ogrn: data.ogrn, type: data.companyType,
      }).eq('id', 'main');
    } else {
      await db.from('companies').insert({
        id: 'main', name: data.companyName, inn: data.inn, ogrn: data.ogrn, type: data.companyType,
      });
    }
    const c: Company = {
      id: 'main', name: data.companyName, inn: data.inn,
      ogrn: data.ogrn, type: data.companyType, createdAt: new Date().toISOString(),
    };

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
      companyId: 'main',
      companyName: data.companyName,
      fullName: data.fullName,
      department: 'Руководство',
      inn: data.inn,
      ogrn: data.ogrn,
    };
    setUser(u);
    setCompany(c);

    return {};
  };

  const signIn = async (email: string, password: string) => {
    const result = await auth.signInWithPassword({ email, password });

    if (!result.user) {
      throw new Error('Не удалось войти. Проверьте email и пароль.');
    }

    const comp = await loadCompany();
    setCompany(comp);
    const u = await buildUser(result.user, comp);
    setUser(u);
  };

  const signInWithPin = async (pin: string, adpodSlug: string) => {
    const result = await auth.pinSignIn(pin, adpodSlug);

    if (!result.user) {
      throw new Error('Не удалось войти по пин-коду.');
    }

    const comp = await loadCompany();
    setCompany(comp);
    const u = await buildUser(result.user, comp);
    setUser(u);
  };

  const signOut = async () => {
    await auth.signOut();
    setUser(null);
    setCompany(null);
  };

  const refreshUser = async () => {
    const session = await auth.getSession();
    if (session?.user) {
      const comp = await loadCompany();
      setCompany(comp);
      const u = await buildUser(session.user, comp);
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
    <AuthContext.Provider value={{ user, company, loading, signUp, signIn, signInWithPin, signOut, refreshUser, refreshRoles }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}