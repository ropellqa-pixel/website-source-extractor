interface AnodBizLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: { box: 'w-9 h-9', fs: 'text-[17px]' },
  md: { box: 'w-14 h-14', fs: 'text-[24px]' },
  lg: { box: 'w-20 h-20 rounded-[18px]', fs: 'text-[34px]' },
};

export default function AnodBizLogo({ size = 'md', className = '' }: AnodBizLogoProps) {
  const s = sizes[size];
  return (
    <div className={`inline-flex ${className}`} aria-hidden="true">
      <div className={`logo-mark ${s.box} ${s.fs}`}>
        <b className="relative text-[0.43em] tracking-[0.06em]" style={{ color: 'hsl(var(--logo-bar))' }}>АНОД</b>
        <b className="relative mt-px text-[0.6em] text-white">БИЗ</b>
      </div>
    </div>
  );
}
