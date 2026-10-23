import { db } from '@/lib/sdk';
import type { ConfigParams, ConfiguratorKind, ConfiguratorRecord } from './configuratorCatalog';

const TABLE = 'schedule_configurators';

function normalize(r: Record<string, unknown>): ConfiguratorRecord {
  let params = r.params as unknown;
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch { params = {}; }
  }
  return {
    id: String(r.id),
    company_id: (r.company_id as string) ?? null,
    name: (r.name as string) || '',
    kind: ((r.kind as string) || 'condition') as ConfiguratorKind,
    params: (params && typeof params === 'object' ? params : { template: '' }) as ConfigParams,
    is_active: r.is_active !== false,
    created_by: (r.created_by as string) ?? null,
    created_at: r.created_at as string | undefined,
    updated_at: r.updated_at as string | undefined,
  };
}

export function parseIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
    } catch {
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export async function loadConfigurators(companyId?: string): Promise<ConfiguratorRecord[]> {
  const { data, error } = await db.from(TABLE).select('*').order('created_at', { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[])
    .map(normalize)
    .filter(c => !companyId || !c.company_id || c.company_id === companyId);
}

export async function createConfigurator(values: {
  name: string; kind: ConfiguratorKind; params: ConfigParams; company_id?: string; created_by?: string;
}): Promise<ConfiguratorRecord | null> {
  const { data, error } = await db.from(TABLE).insert({ ...values, is_active: true });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? normalize(row) : null;
}

export async function updateConfigurator(id: string, values: Partial<Pick<ConfiguratorRecord, 'name' | 'kind' | 'params' | 'is_active'>>) {
  const { error } = await db.from(TABLE).update({ ...values, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteConfigurator(id: string) {
  const { error } = await db.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(error.message);
}
