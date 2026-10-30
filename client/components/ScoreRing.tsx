import { scoreRingColor } from "@/lib/format";

export default function ScoreRing({ percent, size = 96, label }: { percent: number; size?: number; label?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  const color = scoreRingColor(value);

  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-ink/10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: "stroke-dasharray .6s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="font-display text-2xl font-semibold tracking-[-.04em]" style={{ color }}>{value}%</p>
        {label && <p className="mt-0.5 text-[9px] uppercase tracking-[.14em] text-ink/40">{label}</p>}
      </div>
    </div>
  );
}
