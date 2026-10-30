const CURRENCY_LOCALE: Record<string, string> = { INR: "en-IN", USD: "en-US", EUR: "de-DE", GBP: "en-GB", JPY: "ja-JP", RUB: "ru-RU" };

/** Compact, locale-aware salary such as ₹28L, $120K, or €65K. */
export function formatSalary(value: number | null | undefined, currency = "INR") {
  if (value == null || !Number.isFinite(value)) return null;
  const code = (currency || "INR").toUpperCase();
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALE[code] ?? "en-US", {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${code} ${Math.round(value / 1000)}K`;
  }
}

export function salaryLabel(job: { salaryMin?: number | null; salaryMax?: number | null; salaryCurrency?: string | null }) {
  const currency = job.salaryCurrency ?? "INR";
  const min = formatSalary(job.salaryMin, currency);
  const max = formatSalary(job.salaryMax, currency);
  if (min && max && min !== max) return `${min} – ${max}`;
  if (min) return `${min}+`;
  if (max) return `Up to ${max}`;
  return null;
}

export function experienceLabel(min?: number | null, max?: number | null) {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${min}–${max} yrs`;
  if (min != null) return `${min}+ yrs`;
  return `Up to ${max} yrs`;
}

export function timeAgo(value?: string | Date | null) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function formatDate(value?: string | Date | null) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

const LOGO_TONES = [
  "bg-[#dff1e8] text-[#27634e]",
  "bg-[#e9e3fb] text-[#5f4b9d]",
  "bg-[#f6e2d8] text-[#9a4a2f]",
  "bg-[#e1eef9] text-[#32618c]",
  "bg-[#f3ecd3] text-[#7d6220]",
  "bg-[#f4dde6] text-[#8c3c5b]",
  "bg-[#e4ece2] text-[#46603f]",
  "bg-[#e8e4dc] text-[#5d5648]",
];

export function logoTone(name?: string | null) {
  const value = name ?? "";
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return LOGO_TONES[hash % LOGO_TONES.length];
}

export function sourceLabel(job: { source?: string; sourceName?: string | null; sourceLabel?: string }) {
  if (job.sourceLabel) return job.sourceLabel;
  if (job.sourceName) return job.sourceName;
  return job.source === "RECRUITER" ? "Direct listing" : "External";
}

export function employmentTypes() {
  return ["Full-time", "Part-time", "Contract", "Freelance", "Internship", "Temporary"];
}

export const APPLICATION_STAGES = ["SUBMITTED", "IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFERED"] as const;

export function applicationStageIndex(status: string) {
  if (status === "REJECTED" || status === "WITHDRAWN") return -1;
  const index = APPLICATION_STAGES.indexOf(status as (typeof APPLICATION_STAGES)[number]);
  return index === -1 ? 0 : index;
}

export function statusLabel(status: string) {
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

export function statusTone(status: string) {
  switch (status) {
    case "OFFERED":
      return "bg-[#dff1e8] text-[#27634e]";
    case "INTERVIEW":
      return "bg-[#e1eef9] text-[#32618c]";
    case "SHORTLISTED":
      return "bg-[#e9e3fb] text-[#5f4b9d]";
    case "REJECTED":
      return "bg-[#f8e0dc] text-[#9a3f33]";
    case "WITHDRAWN":
      return "bg-ink/10 text-ink/50";
    case "IN_REVIEW":
      return "bg-[#f3ecd3] text-[#7d6220]";
    default:
      return "bg-ink/[.06] text-ink/60";
  }
}

export function matchTone(percent: number) {
  if (percent >= 75) return "bg-[#dff1e8] text-[#27634e]";
  if (percent >= 55) return "bg-[#f3ecd3] text-[#7d6220]";
  return "bg-ink/[.06] text-ink/55";
}

export function scoreRingColor(percent: number) {
  if (percent >= 75) return "#2f7a56";
  if (percent >= 55) return "#b08a2c";
  return "#b0644f";
}
