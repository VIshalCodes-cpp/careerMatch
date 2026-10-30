export default function Progress({ value, tone = "coral", className = "" }: { value: number; tone?: "coral" | "green" | "blue" | "ink"; className?: string }) {
  const colors = { coral: "bg-coral", green: "bg-[#3f8a63]", blue: "bg-[#4b7fae]", ink: "bg-ink" };
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-ink/10 ${className}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-500 ${colors[tone]}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
