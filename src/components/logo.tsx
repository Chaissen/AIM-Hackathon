export function Logo() {
  return (
    <span className="flex items-center gap-2 text-loud">
      <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden className="text-primary">
        <rect x="2" y="3" width="15" height="6" rx="2" fill="currentColor" />
        <rect x="9" y="10" width="15" height="6" rx="2" fill="currentColor" opacity=".55" />
        <rect x="2" y="17" width="15" height="6" rx="2" fill="currentColor" opacity=".3" />
      </svg>
      <span className="font-heading text-lg leading-none font-bold tracking-[-0.03em] font-stretch-[125%]">ordy</span>
    </span>
  );
}
