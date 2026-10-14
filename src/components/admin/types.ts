import type { FieldDef } from '@/lib/access';

export interface Position { id: number; name: string; sections: string[]; actions: string[]; people: number }
export interface Person { id: string; name: string; role: string; department: string; position_id: number | null; active: boolean }
export interface Category { id: number; kind: 'income' | 'expense'; name: string; archived: boolean }
export interface Counterparty { id: number; name: string; kind: string; inn: string | null; phone: string | null; comment: string | null; archived: boolean }

export interface AdminData {
  sections: { path: string; label: string }[];
  actions: { key: string; group: string; label: string }[];
  positions: Position[];
  people: Person[];
  formulas: Record<string, string>;
  default_formulas: Record<string, string>;
  formula_labels: Record<string, string>;
  formula_order: string[];
  fields: Record<string, FieldDef[]>;
  default_fields: Record<string, FieldDef[]>;
  variables: Record<'global' | 'salary' | 'manager', { var: string; label: string }[]>;
  params: { percent: number; manager_percent: number };
  categories: Category[];
  counterparties: Counterparty[];
}
