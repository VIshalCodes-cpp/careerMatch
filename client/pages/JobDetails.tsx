import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Bookmark, BookmarkCheck, Building2, CalendarDays, Check, CheckCircle2, Clock, ExternalLink,
  EyeOff, FileText, Link2, MapPin, Send, Share2, Sparkles, X,
} from "lucide-react";
import CompanyLogo from "@/components/CompanyLogo";
import JobCard from "@/components/JobCard";
import ScoreRing from "@/components/ScoreRing";
import Progress from "@/components/Progress";
import { api, Envelope } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { experienceLabel, formatDate, salaryLabel, sourceLabel, statusLabel, timeAgo } from "@/lib/format";
import type { Job, ResumeRecord } from "@/lib/types";

function JobDescription({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
    const output: { type: "h" | "p" | "ul"; content: string; items?: string[] }[] = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^[•\-*·]\s*/.test(line)) {
        const items: string[] = [];
        while (index < lines.length && /^[•\-*·]\s*/.test(lines[index])) {
          items.push(lines[index].replace(/^[•\-*·]\s*/, ""));
          index++;
        }
        index--;
        output.push({ type: "ul", content: "", items });
        continue;
      }
      const next = lines[index + 1];
      const looksLikeHeading = line.length <= 72 && !/[.!?]$/.test(line) && /^[A-Z]/.test(line) && next && (/^[•\-*·]\s*/.test(next) || next.length > 80 || /^[A-Z]/.test(next));
      if (looksLikeHeading) output.push({ type: "h", content: line.replace(/:$/, "") });
      else output.push({ type: "p", content: line });
    }
    return output;
  }, [text]);

  return (
    <div className="mt-5 space-y-4 text-[15px] leading-7 text-ink/65">
      {blocks.map((block, index) => {
        if (block.type === "h") return <h3 key={index} className="!mt-8 font-display text-lg font-semibold tracking-[-.02em] text-ink">{block.content}</h3>;
        if (block.type === "ul") return <ul key={index} className="space-y-2 pl-1">{block.items?.map((item, itemIndex) => <li key={itemIndex} className="flex gap-2.5"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-coral/70" /><span>{item}</span></li>)}</ul>;
        return <p key={index}>{block.content}</p>;
      })}
    </div>
  );
}

export default function JobDetails() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedBusy, setSavedBusy] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);

  const isCandidate = Boolean(user?.roles.includes("CANDIDATE"));
  const applied = Boolean(job?.applied) || Boolean(job?.applicationStatus && job.applicationStatus !== "WITHDRAWN");
  const external = Boolean(job?.applyUrl);

  const load = () => {
    if (!jobId) return;
    setLoading(true);
    api<Envelope<Job>>(`/jobs/${jobId}`)
      .then((result) => {
        setJob(result.data);
        setSaved(Boolean(result.data.saved));
        setError("");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load this listing."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [jobId]);

  const openApply = async () => {
    if (!user) return navigate(`/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`);
    if (!isCandidate) { setNotice("Sign in with a candidate account to apply."); return; }
    setApplyOpen(true);
    setNotice("");
    try {
      const result = await api<Envelope<ResumeRecord[]>>("/me/resumes");
      const processed = result.data.filter((resume) => resume.status === "PROCESSED");
      setResumes(result.data);
      setResumeId(processed[0]?.id ?? "");
    } catch {
      setResumes([]);
    }
  };

  const submitApplication = async () => {
    if (!job) return;
    setApplying(true);
    setError("");
    let popup: Window | null = null;
    try {
      if (external) {
        // Open the tab synchronously so popup blockers allow it, then point it
        // at the employer's URL once the tracked request returns.
        popup = window.open("about:blank", "_blank");
        const result = await api<Envelope<{ url: string }>>(`/jobs/${job.id}/apply-link`, { method: "POST" });
        if (popup) {
          popup.opener = null;
          popup.location.href = result.data.url;
        } else {
          window.open(result.data.url, "_blank", "noopener,noreferrer");
        }
        setNotice(`Opened the application on ${job.sourceName ?? "the employer site"}. We added it to your tracker.`);
        setJob((current) => current && ({ ...current, applied: true, applicationStatus: "SUBMITTED" }));
      } else {
        await api(`/jobs/${job.id}/applications`, { method: "POST", body: JSON.stringify({ coverLetter: coverLetter || undefined, resumeId: resumeId || undefined }) });
        setNotice("Application submitted. You can follow its status in Applications.");
        setJob((current) => current && ({ ...current, applied: true, applicationStatus: "SUBMITTED" }));
      }
      setApplyOpen(false);
      setCoverLetter("");
    } catch (reason) {
      popup?.close();
      setError(reason instanceof Error ? reason.message : "Could not submit the application.");
    } finally {
      setApplying(false);
    }
  };

  const toggleSave = async () => {
    if (!user) return navigate(`/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`);
    if (!isCandidate || !job) { setNotice("Only candidate accounts can save jobs."); return; }
    const next = !saved;
    setSavedBusy(true);
    setSaved(next);
    setError("");
    try {
      await api(`/jobs/${job.id}/save`, { method: next ? "POST" : "DELETE" });
      setNotice(next ? "Saved to your dashboard." : "Removed from saved jobs.");
    } catch (reason) {
      setSaved(!next);
      setError(reason instanceof Error ? reason.message : "Could not update this saved job.");
    } finally {
      setSavedBusy(false);
    }
  };

  const dismiss = async () => {
    if (!job || !isCandidate) return;
    try {
      await api("/recommendations/interactions", { method: "POST", body: JSON.stringify({ jobId: job.id, type: "DISMISS" }) });
      navigate("/jobs");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not hide this role.");
    }
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice("Copy the URL from your address bar to share this role.");
    }
  };

  if (loading) {
    return (
      <main className="shell py-16">
        <div className="animate-pulse space-y-6">
          <div className="h-4 w-32 rounded bg-ink/10" />
          <div className="flex gap-5"><div className="size-16 rounded-2xl bg-ink/10" /><div className="flex-1 space-y-3"><div className="h-8 w-2/3 rounded bg-ink/10" /><div className="h-4 w-1/3 rounded bg-ink/[.07]" /></div></div>
          <div className="h-64 rounded-2xl bg-ink/[.05]" />
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="shell py-20">
        <p role="alert" className="text-sm text-red-700">{error || "This listing is no longer available."}</p>
        <Link to="/jobs" className="back-link mt-6"><ArrowLeft size={15} /> Back to jobs</Link>
      </main>
    );
  }

  const fit = job.fit ?? null;
  const salary = salaryLabel(job);
  const experience = experienceLabel(job.experienceMin, job.experienceMax);

  return (
    <main className="shell py-10 md:py-14">
      <div className="flex items-center justify-between">
        <Link to="/jobs" className="back-link"><ArrowLeft size={15} /> Back to opportunities</Link>
        <button type="button" onClick={() => void share()} className="chip" aria-label="Share this job">
          {copied ? <Check size={13} /> : <Share2 size={13} />} {copied ? "Link copied" : "Share"}
        </button>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <div className="flex items-start gap-5">
            <CompanyLogo name={job.company?.name} logoUrl={job.company?.logoUrl} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/companies/${job.company?.id}`} className="eyebrow hover:text-ink">{job.company?.name}</Link>
                {external ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-ink/[.06] px-2 py-0.5 text-[10px] font-medium text-ink/50"><ExternalLink size={10} /> via {job.sourceName ?? "partner feed"}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#dff1e8] px-2 py-0.5 text-[10px] font-semibold text-[#27634e]">Direct listing</span>
                )}
              </div>
              <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-[-.055em] sm:text-5xl">{job.title}</h1>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink/50">
                <span className="flex items-center gap-1.5"><MapPin size={15} /> {job.location}</span>
                {salary && <span className="font-medium text-ink/65">{salary}</span>}
                {job.employmentType && <span>{job.employmentType}</span>}
                {experience && <span>{experience}</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/40">
                <span className="flex items-center gap-1.5"><Clock size={12} /> Posted {timeAgo(job.publishedAt ?? job.createdAt)}</span>
                {job.expiresAt && <span className="flex items-center gap-1.5"><CalendarDays size={12} /> Closes {formatDate(job.expiresAt)}</span>}
                {job._count && <span>{job._count.applications} applicant{job._count.applications === 1 ? "" : "s"}</span>}
              </div>
            </div>
          </div>

          {notice && <p role="status" className="mt-6 rounded-xl border border-[#2f7a56]/25 bg-[#dff1e8]/60 px-4 py-3 text-sm text-[#27634e]">{notice}</p>}
          {error && <p role="alert" className="mt-6 rounded-xl border border-red-300/40 bg-red-50/60 px-4 py-3 text-sm text-red-700">{error}</p>}

          <section className="mt-10 border-t border-ink/10 pt-8">
            <h2 className="section-title">About the role</h2>
            <JobDescription text={job.description ?? job.excerpt ?? ""} />
          </section>

          <section className="mt-12 border-t border-ink/10 pt-8">
            <h2 className="section-title">Skills and requirements</h2>
            <div className="mt-5 flex flex-wrap gap-2">
              {job.skills.map((skill) => {
                const matched = fit?.matchedSkills.some((entry) => entry.toLowerCase() === skill.name.toLowerCase());
                return (
                  <span key={skill.name} className={`skill-pill border ${matched ? "border-[#2f7a56]/25 bg-[#dff1e8] text-[#27634e]" : skill.required ? "border-ink/15 bg-ink/[.05] text-ink/70" : "border-ink/10 bg-transparent text-ink/50"}`}>
                    {matched && <Check size={11} className="mr-1" />}{skill.name}{skill.required ? "" : " · preferred"}
                  </span>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-ink/40">Green skills already appear on your profile. Preferred skills are a bonus, not a gate.</p>
          </section>

          {job.similarJobs && job.similarJobs.length > 0 && (
            <section className="mt-12 border-t border-ink/10 pt-8">
              <div className="flex items-end justify-between">
                <h2 className="section-title">Similar roles</h2>
                <Link to="/jobs" className="text-xs text-ink/50 hover:text-ink">Browse all</Link>
              </div>
              <div className="mt-5 space-y-3">{job.similarJobs.map((similar) => <JobCard key={similar.id} job={similar} />)}</div>
            </section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="fit-card !bg-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Profile fit</p>
                <p className="mt-2 max-w-[190px] text-xs leading-5 text-ink/45">
                  {isCandidate ? "A relative comparison with your saved profile — not a hiring probability." : "Sign in as a candidate to compare this role with your profile."}
                </p>
              </div>
              {fit ? <ScoreRing percent={fit.scorePercent} size={88} label="match" /> : (
                <span className="grid size-16 place-items-center whitespace-pre-line rounded-full border border-dashed border-ink/20 text-center text-[10px] leading-4 text-ink/40">{isCandidate ? "Add\nskills" : "Sign\nin"}</span>
              )}
            </div>

            {fit && (
              <div className="mt-5 space-y-3 border-t border-ink/10 pt-4">
                {[
                  { label: "Skills", value: fit.components.skills },
                  { label: "Experience", value: fit.components.experience },
                  { label: "Description match", value: fit.components.semantic },
                ].map((component) => (
                  <div key={component.label}>
                    <div className="flex items-center justify-between text-[11px] text-ink/45"><span>{component.label}</span><span className="mono">{Math.round(component.value * 100)}%</span></div>
                    <Progress value={component.value * 100} tone={component.value >= 0.7 ? "green" : component.value >= 0.4 ? "coral" : "ink"} className="mt-1.5" />
                  </div>
                ))}
                <div className="pt-1 text-xs leading-5">
                  <p className="text-ink/45">Matched skills</p>
                  <p className="mt-1 text-ink/70">{fit.matchedSkills.length ? fit.matchedSkills.join(", ") : "None yet — add skills to your profile."}</p>
                  {fit.missingRequiredSkills.length > 0 && (
                    <>
                      <p className="mt-3 text-ink/45">Missing required</p>
                      <p className="mt-1 text-coral">{fit.missingRequiredSkills.join(", ")}</p>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="mt-5 space-y-2.5">
              {applied ? (
                <div className="rounded-lg border border-[#2f7a56]/25 bg-[#dff1e8]/60 px-4 py-3 text-sm text-[#27634e]">
                  <p className="flex items-center gap-2 font-medium"><CheckCircle2 size={15} /> Application recorded</p>
                  <p className="mt-1 text-xs">Status: {statusLabel(job.applicationStatus ?? "SUBMITTED")}. {external ? "Finish the steps on the employer site." : "Track updates in Applications."}</p>
                  <Link to="/applications" className="mt-2 inline-block text-xs underline underline-offset-2">Open tracker</Link>
                </div>
              ) : !user ? (
                <Link to={`/login?next=${encodeURIComponent(`/jobs/${job.id}`)}`} className="button button-coral w-full">Sign in to apply</Link>
              ) : !isCandidate ? (
                <p className="rounded-lg border border-ink/10 bg-secondary/50 px-4 py-3 text-xs leading-5 text-ink/50">Recruiter accounts cannot apply to roles. Use a candidate account to submit an application.</p>
              ) : (
                <button type="button" onClick={() => void openApply()} className="button button-coral w-full">
                  {external ? <><ExternalLink size={15} /> Apply on {job.sourceName ?? "company site"}</> : <><Send size={15} /> Apply now</>}
                </button>
              )}
              {isCandidate && (
                <button type="button" disabled={savedBusy} onClick={() => void toggleSave()} className="button button-outline w-full">
                  {saved ? <><BookmarkCheck size={15} /> Saved</> : <><Bookmark size={15} /> Save for later</>}
                </button>
              )}
            </div>

            {external && <p className="mt-3 text-[10px] leading-4 text-ink/35">This role is hosted by {job.sourceName ?? "a partner feed"}. Applying opens the original posting; we record the click so it appears in your tracker.</p>}
          </div>

          <div className="panel">
            <p className="eyebrow"><Building2 size={12} /> Company</p>
            <div className="mt-3 flex items-center gap-3">
              <CompanyLogo name={job.company?.name} logoUrl={job.company?.logoUrl} />
              <div className="min-w-0">
                <p className="truncate font-medium">{job.company?.name}</p>
                <p className="text-xs text-ink/45">{job.company?.location ?? "Location not provided"}</p>
              </div>
            </div>
            {job.company?.website && <a href={job.company.website} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink/50 hover:text-ink"><Link2 size={12} /> {job.company.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>}
            <Link to={`/companies/${job.company?.id}`} className="button button-outline mt-4 w-full !py-2.5 text-xs">View company</Link>
          </div>

          <div className="rounded-xl border border-ink/10 px-4 py-3 text-[11px] leading-5 text-ink/40">
            <p className="flex items-center gap-1.5 font-medium text-ink/55"><Sparkles size={12} className="text-coral" /> Transparent by design</p>
            <p className="mt-1.5">Fit uses skills, experience, preferences and an in-process text comparison. No demographic data is used.</p>
            {isCandidate && <button type="button" onClick={() => void dismiss()} className="mt-2 inline-flex items-center gap-1 text-ink/40 underline underline-offset-2 hover:text-ink"><EyeOff size={11} /> Not interested</button>}
          </div>
        </aside>
      </div>

      {applyOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Apply to this role" onClick={() => !applying && setApplyOpen(false)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-ink/10 px-6 py-4">
              <div>
                <p className="eyebrow">Application</p>
                <h2 className="mt-1.5 font-display text-xl font-semibold tracking-[-.03em]">{job.title}</h2>
                <p className="mt-1 text-xs text-ink/45">{job.company?.name} · {job.location}</p>
              </div>
              <button type="button" onClick={() => setApplyOpen(false)} className="grid size-8 place-items-center rounded-full text-ink/40 hover:bg-ink/[.05] hover:text-ink" aria-label="Close"><X size={17} /></button>
            </div>
            <div className="space-y-5 px-6 py-5">
              {external ? (
                <div className="rounded-xl border border-ink/10 bg-secondary/50 p-4 text-sm leading-6 text-ink/60">
                  <p className="font-medium text-ink">This application continues on {job.sourceName ?? "the employer site"}.</p>
                  <p className="mt-1 text-xs leading-5">Click continue to open the original posting in a new tab. We will mark it as applied in your tracker so you can follow up.</p>
                  {job.applyUrl && <p className="mt-2 break-all text-[11px] text-ink/35">{job.applyUrl}</p>}
                </div>
              ) : (
                <>
                  <label className="input-label">
                    Resume
                    <select className="field mt-2" value={resumeId} onChange={(event) => setResumeId(event.target.value)}>
                      <option value="">No resume attached</option>
                      {resumes.filter((resume) => resume.status === "PROCESSED").map((resume) => <option key={resume.id} value={resume.id}>{resume.originalName}</option>)}
                    </select>
                    {!resumes.filter((resume) => resume.status === "PROCESSED").length && <span className="mt-1 block text-xs text-ink/40">No processed resume yet. You can <Link to="/profile" className="underline underline-offset-2">upload one</Link>, or apply without attaching it.</span>}
                  </label>
                  <label className="input-label">
                    Note to the recruiter <span className="font-normal text-ink/35">(optional)</span>
                    <textarea className="field mt-2 h-32 py-3" maxLength={6000} value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} placeholder="Why this role, and what you would bring to it…" />
                  </label>
                </>
              )}
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setApplyOpen(false)} className="button button-outline">Cancel</button>
                <button type="button" onClick={() => void submitApplication()} disabled={applying} className="button button-coral">
                  {applying ? "Submitting…" : external ? <><ExternalLink size={15} /> Continue to application</> : <><Send size={15} /> Submit application</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-6 text-xs text-ink/35">
        <span>Listing source: {sourceLabel(job)}{job.sourceName ? ` · ${job.sourceName}` : ""}</span>
        <span className="flex items-center gap-1.5"><FileText size={12} /> Apply only where the details are clear.</span>
      </div>
    </main>
  );
}
