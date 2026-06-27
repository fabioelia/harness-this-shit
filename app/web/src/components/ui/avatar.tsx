import { cn } from '@/lib/utils';

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  accent,
  size = 24,
  className,
}: {
  name: string;
  accent?: string;
  size?: number;
  className?: string;
}) {
  const c = accent || '#8A93A7';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none',
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(160deg, ${c}33, ${c}14)`,
        color: c,
        border: `1px solid ${c}44`,
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
