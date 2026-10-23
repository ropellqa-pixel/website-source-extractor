import Icon from '@/components/ui/icon';
import { ConfiguratorKind, KIND_META } from './configuratorCatalog';

export default function KindBadge({ kind, className = '' }: { kind: ConfiguratorKind; className?: string }) {
  const meta = KIND_META[kind] || KIND_META.condition;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${meta.badge} ${className}`}>
      <Icon name={meta.icon} className="w-3 h-3" />
      {meta.label}
    </span>
  );
}
