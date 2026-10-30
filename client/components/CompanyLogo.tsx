import { useState } from "react";
import { initials, logoTone } from "@/lib/format";

const SIZES = {
  sm: "size-9 rounded-lg text-[11px]",
  md: "size-11 rounded-xl text-sm",
  lg: "size-16 rounded-2xl text-xl",
  xl: "size-20 rounded-2xl text-2xl",
};

export default function CompanyLogo({
  name,
  logoUrl,
  size = "md",
  className = "",
}: {
  name?: string | null;
  logoUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const base = `grid shrink-0 place-items-center overflow-hidden font-bold ${SIZES[size]} ${className}`;

  if (logoUrl && !broken) {
    return (
      <span className={`${base} border border-ink/10 bg-white`}>
        <img src={logoUrl} alt="" loading="lazy" className="size-full object-contain p-1.5" onError={() => setBroken(true)} />
      </span>
    );
  }

  return (
    <span className={`${base} ${logoTone(name)}`} aria-hidden="true" style={{ fontFamily: "Manrope, sans-serif" }}>
      {initials(name)}
    </span>
  );
}
