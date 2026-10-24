import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { bizCall } from '@/lib/bizApi';

interface Ctx { checked: boolean; allowed: boolean; isBizAdmin: boolean; reload: () => Promise<void> }

const LicenseContext = createContext<Ctx>({ checked: false, allowed: true, isBizAdmin: false, reload: async () => {} });

export function LicenseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState({ checked: false, allowed: true, isBizAdmin: false });

  const reload = useCallback(async () => {
    if (!user) { setState({ checked: true, allowed: true, isBizAdmin: false }); return; }
    const r = await bizCall<{ license?: { allowed: boolean }; is_biz_admin?: boolean }>({ action: 'my_license' });
    if (r.error && !r.license) { setState({ checked: true, allowed: true, isBizAdmin: false }); return; }
    setState({ checked: true, allowed: !!r.license?.allowed, isBizAdmin: !!r.is_biz_admin });
  }, [user]);

  useEffect(() => { setState(s => ({ ...s, checked: false })); reload(); }, [reload]);

  return <LicenseContext.Provider value={{ ...state, reload }}>{children}</LicenseContext.Provider>;
}

export function useLicenseState() {
  return useContext(LicenseContext);
}
