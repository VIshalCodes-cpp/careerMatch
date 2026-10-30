import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Bookmark, BookmarkCheck, ExternalLink, MapPin, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import CompanyLogo from "@/components/CompanyLogo";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { experienceLabel, matchTone, salaryLabel, timeAgo } from "@/lib/format";
import type { Job } from "@/lib/types";

export default function JobCard({
  job,
  onSavedChange,
  highlight = true,
  rank,
}: {
  job: Job;
  onSavedChange?: (jobId: string, saved: boolean) => void;
  highlight?: boolean;
  rank?: number;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(Boolean(job.saved));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const percent = job.scorePercent ?? job.fit?.scorePercent;
  const matched = job.matchedSkills ?? job.fit?.matchedSkills ?? [];
  const missing = job.missingRequiredSkills ?? job.fit?.missingRequiredSkills ?? [];

  useEffect(() => setSaved(Boolean(job.saved)), [job.saved, job.id]);

  const toggleSave = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/jobs/${job.id}`)}`);
      return;
    }
    if (!user.roles.includes("CANDIDATE") || busy) return;
    const next = !saved;
    setBusy(true);
    setNotice("");
    setSaved(next);
    onSavedChange?.(job.id, next);
    try {
      await api(`/jobs/${job.id}/save`, { method: next ? "POST" : "DELETE" });
    } catch (reason) {
      setSaved(!next);
      onSavedChange?.(job.id, !next);
      setNotice(reason instanceof Error ? reason.message : "Could not update this saved job.");
    } finally {
      setBusy(false);
    }
  };

  const salary = salaryLabel(job);
  const experience = experienceLabel(job.experienceMin, job.experienceMax);
  const external = job.source === "EXTERNAL" || Boolean(job.applyUrl);

  return (
    <article className="job-card group">
      {rank != null && (
        <span className="pointer-events-none absolute -left-2.5 -top-2.5 z-20 grid size-7 place-items-center rounded-full bg-ink text-[11px] font-semibold text-paper shadow-sm ring-2 ring-background">
          {rank}
        </span>
      )}
      <Link to={`/jobs/${job.id}`} className="absolute inset-0 z-0 rounded-2xl" aria-label={`View ${job.title}`} />
      <CompanyLogo name={job.company?.name} logoUrl={job.company?.logoUrl} />

      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pr-12">
          <h3 className="font-display text-[17px] font-semibold tracking-[-.02em] text-ink transition-colors group-hover:text-coral">
            {job.title}
          </h3>
          {percent != null && (
            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${matchTone(percent)}`}>
              <Sparkles size={11} /> {Math.round(percent)}% fit
            </span>
          )}
          {job.applied && <span className="rounded-md bg-[#e1eef9] px-2 py-0.5 text-[11px] font-semibold text-[#32618c]">Applied</span>}
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-ink/50">
          <span className="font-medium text-ink/65">{job.company?.name}</span>
          <span className="text-ink/25">·</span>
          <span className="inline-flex items-center gap-1"><MapPin size={12} /> {job.location}</span>
          {salary && <><span className="text-ink/25">·</span><span>{salary}</span></>}
        </p>

        {job.excerpt && <p className="mt-2 line-clamp-2 max-w-2xl text-[13px] leading-6 text-ink/50">{job.excerpt}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {job.skills.slice(0, 5).map((skill) => {
            const skillKey = (skill.normalizedName ?? skill.name).toLowerCase();
            const isMatched = highlight && matched.some((entry) => entry.toLowerCase() === skillKey || entry.toLowerCase() === skill.name.toLowerCase());
            const isMissing = highlight && missing.some((entry) => entry.toLowerCase() === skillKey || entry.toLowerCase() === skill.name.toLowerCase());
            return (
              <span
                key={skill.name}
                className={`tag ${isMatched ? "!bg-[#dff1e8] !text-[#27634e]" : isMissing ? "!bg-[#f8e0dc] !text-[#9a3f33]" : ""}`}
              >
                {skill.name}
                {skill.required ? "" : " · preferred"}
              </span>
            );
          })}
          {job.skills.length > 5 && <span className="tag">+{job.skills.length - 5}</span>}
          {experience && <span className="ml-1 text-[11px] text-ink/40">{experience}</span>}
          {job.employmentType && <span className="text-[11px] text-ink/40">· {job.employmentType}</span>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/40">
          <span>{timeAgo(job.publishedAt ?? job.createdAt)}</span>
          {external ? (
            <span className="inline-flex items-center gap-1"><ExternalLink size={11} /> via {job.sourceName ?? "partner feed"}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[#27634e]"><span className="size-1.5 rounded-full bg-[#2f7a56]" /> Direct listing</span>
          )}
        </div>
        {notice && <p className="relative z-10 mt-2 text-xs text-red-600">{notice}</p>}
      </div>

      <div className="pointer-events-auto relative z-10 flex shrink-0 flex-col items-end justify-between gap-3">
        {user?.roles.includes("CANDIDATE") && (
          <button
            type="button"
            onClick={() => void toggleSave()}
            disabled={busy}
            aria-label={saved ? "Remove from saved jobs" : "Save job"}
            className={`grid size-9 place-items-center rounded-full border transition-colors ${saved ? "border-coral/30 bg-coral/10 text-coral" : "border-ink/10 text-ink/40 hover:border-coral/40 hover:text-coral"}`}
          >
            {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          </button>
        )}
        <span className="hidden size-8 place-items-center rounded-full border border-ink/10 text-ink/35 transition-all group-hover:border-coral group-hover:bg-coral group-hover:text-white sm:grid">
          <ArrowUpRight size={15} />
        </span>
      </div>
    </article>
  );
}
