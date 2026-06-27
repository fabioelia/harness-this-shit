/** Switchboard mark — a patch bay: a trunk line fanning out to three jacks,
 *  one of them "patched" (filled) — the routing + collision-control idea in one glyph. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect x="1" y="1" width="26" height="26" rx="7" fill="#10141D" stroke="#222B3D" />
      <path d="M7 8.5h3.2c1 0 1.8.8 1.8 1.8v0c0 1 .8 1.8 1.8 1.8H21" stroke="#5C6577" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7 14h6.2c1 0 1.8.8 1.8 1.8v0c0 1 .8 1.8 1.8 1.8H21" stroke="#8B7CFF" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 19.5h9.2c1 0 1.8-.8 1.8-1.8" stroke="#5C6577" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="8.5" r="1.6" fill="#5C6577" />
      <circle cx="7" cy="14" r="1.8" fill="#8B7CFF" />
      <circle cx="7" cy="19.5" r="1.6" fill="#5C6577" />
      <circle cx="21" cy="11.5" r="1.6" fill="#5C6577" />
      <circle cx="21" cy="17.4" r="1.8" fill="#8B7CFF" />
    </svg>
  );
}
