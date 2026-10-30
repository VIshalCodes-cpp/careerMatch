import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  BriefcaseBusiness, Building2, CheckCircle2, ChevronDown, Eye, FileText, Pencil, Plus, RefreshCw, Trash2, Users, X, XCircle,
} from "lucide-react";
import CompanyLogo from "@/components/CompanyLogo";
import Progress from "@/components/Progress";
import EmptyState from "@/components/EmptyState";
import { api, Envelope } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatDate, statusLabel, statusTone, timeAgo } from "@/lib/format";
import type { Job, JobSkill } from "@/lib/types";

type RecruiterJob = Job & { _count: { applications: number } };
type RecruiterStats = { jobs: number; published: number; drafts: number; closed: number; applications: number; applicationsThisWeek: number; byStatus: { status: string; count: number }[] };
type Company = { id: string; name: string; website?: string | null; location?: string | null; description?: string | null; logoUrl?: string | null; _count?: { jobs: number } };
type Applicant = { id: string; status: string; coverLetter?: string | null; appliedAt: string; resume?: { id: string; originalName: string; status: string } | null; user: { id: string; name: string; email: string; candidate?: any } };
type CandidateMatch = { applicationId: string; applicationStatus: string; candidate: { id: string; name: string; email: string; currentRole?: string; location?: string; experienceYears?: number; skills: string[]; resumeId: string | null }; scorePercent: number; matchedSkills: string[]; missingRequiredSkills: string[]; components: { semantic: number; skills: number; experience: number } };

const TABS = [
  { key: "overview", label: "Overview", icon: BriefcaseBusiness },
  { key: "listings", label: "Listings", icon: Building2 },
  { key: "company", label: "Company", icon: CompanyLogoIcon },
] as const;

function CompanyLogoIcon({ size = 14 }: { size?: number }) {
  return <Building2 size={size} />;
}

function skillsToText(skills: JobSkill[]) {
  return skills.map((skill) => (skill.required ? skill.name : `${skill.name}?`)).join(", ");
}

function textToSkills(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => ({ name: entry.replace(/\?$/, "").trim(), required: !entry.endsWith("?") }));
}

function ListingModal({ job, needsCompany, onClose, onSaved }: { job: RecruiterJob | null; needsCompany: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(job?.title ?? "");
  const [location, setLocation] = useState(job?.location ?? "");
  const [employmentType, setEmploymentType] = useState(job?.employmentType ?? "Full-time");
  const [description, setDescription] = useState(job?.description ?? "");
  const [experienceMin, setExperienceMin] = useState(job?.experienceMin != null ? String(job.experienceMin) : "");
  const [experienceMax, setExperienceMax] = useState(job?.experienceMax != null ? String(job.experienceMax) : "");
  const [salaryMin, setSalaryMin] = useState(job?.salaryMin != null ? String(job.salaryMin) : "");
  const [salaryMax, setSalaryMax] = useState(job?.salaryMax != null ? String(job.salaryMax) : "");
  const [applyUrl, setApplyUrl] = useState(job?.applyUrl ?? "");
  const [skills, setSkills] = useState(job ? skillsToText(job.skills) : "");
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyLocation, setCompanyLocation] = useState("");
  const [publish, setPublish] = useState(job ? job.status === "PUBLISHED" : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload: any = {
      title, location, description, employmentType,
      experienceMin: experienceMin === "" ? (job ? null : undefined) : Number(experienceMin),
      experienceMax: experienceMax === "" ? (job ? null : undefined) : Number(experienceMax),
      salaryMin: salaryMin === "" ? (job ? null : undefined) : Number(salaryMin),
      salaryMax: salaryMax === "" ? (job ? null : undefined) : Number(salaryMax),
      applyUrl: applyUrl.trim() || (job ? null : ""),
      skills: textToSkills(skills),
      status: publish ? "PUBLISHED" : "DRAFT",
      ...(needsCompany && !job ? { companyName, companyWebsite: companyWebsite || undefined, companyLocation: companyLocation || undefined } : {}),
    };
    try {
      if (job) await api(`/recruiter/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api("/recruiter/jobs", { method: "POST", body: JSON.stringify(payload) });
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this listing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={job ? "Edit listing" : "Create listing"} onClick={() => !busy && onClose()}>
      <div className="modal-panel max-w-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-ink/10 px-6 py-4">
          <div>
            <p className="eyebrow">{job ? "Edit listing" : "New listing"}</p>
            <h2 className="mt-1.5 font-display text-xl font-semibold">{job ? job.title : "Create an opportunity"}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full text-ink/40 hover:bg-ink/[.05] hover:text-ink" aria-label="Close"><X size={17} /></button>
        </div>
        <form onSubmit={submit} className="max-h-[72vh] space-y-4 overflow-y-auto px-6 py-5">
          {needsCompany && !job && (
            <div className="rounded-xl border border-coral/25 bg-coral/[.04] p-4">
              <p className="text-sm font-semibold">Add your company profile</p>
              <p className="mt-1 text-xs leading-5 text-ink/45">This is the first listing for your account, so we need a company name. You can refine the public profile in the Company tab afterwards.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="input-label md:col-span-2">Company name<input className="field mt-2" required minLength={2} maxLength={180} value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
                <label className="input-label">Company website<input className="field mt-2" type="url" placeholder="https://" value={companyWebsite} onChange={(event) => setCompanyWebsite(event.target.value)} /></label>
                <label className="input-label">Company location<input className="field mt-2" value={companyLocation} onChange={(event) => setCompanyLocation(event.target.value)} /></label>
              </div>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="input-label md:col-span-2">Job title<input className="field mt-2" required minLength={3} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="input-label">Location<input className="field mt-2" required value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Bengaluru · Hybrid or Remote" /></label>
            <label className="input-label">Employment type<select className="field mt-2" value={employmentType} onChange={(event) => setEmploymentType(event.target.value)}>{["Full-time", "Part-time", "Contract", "Internship", "Freelance"].map((type) => <option key={type}>{type}</option>)}</select></label>
            <label className="input-label">Experience min (years)<input className="field mt-2" type="number" min="0" max="80" value={experienceMin} onChange={(event) => setExperienceMin(event.target.value)} /></label>
            <label className="input-label">Experience max (years)<input className="field mt-2" type="number" min="0" max="80" value={experienceMax} onChange={(event) => setExperienceMax(event.target.value)} /></label>
            <label className="input-label">Salary min (INR/year)<input className="field mt-2" type="number" min="0" value={salaryMin} onChange={(event) => setSalaryMin(event.target.value)} /></label>
            <label className="input-label">Salary max (INR/year)<input className="field mt-2" type="number" min="0" value={salaryMax} onChange={(event) => setSalaryMax(event.target.value)} /></label>
            <label className="input-label md:col-span-2">External application URL <span className="font-normal text-ink/35">(optional)</span><input className="field mt-2" type="url" placeholder="https://company.example/careers/role" value={applyUrl} onChange={(event) => setApplyUrl(event.target.value)} /></label>
            <label className="input-label md:col-span-2">Description<textarea className="field-lg mt-2" required minLength={40} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What the team does, responsibilities, requirements, and benefits…" /></label>
            <label className="input-label md:col-span-2">Skills <span className="font-normal text-ink/35">(comma separated; add ? for preferred)</span><input className="field mt-2" required value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="TypeScript, React, Node.js, PostgreSQL?" /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} /> Publish immediately</label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-ink/10 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="button button-outline">Cancel</button>
            <button disabled={busy} className="button button-dark">{busy ? "Saving…" : job ? "Save changes" : "Create listing"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ApplicantsPanel({ job, onClose }: { job: RecruiterJob; onClose: () => void }) {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [matches, setMatches] = useState<CandidateMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([
      api<Envelope<Applicant[]>>(`/recruiter/jobs/${job.id}/applications`),
      api<Envelope<{ candidates: CandidateMatch[] }>>(`/recruiter/jobs/${job.id}/candidate-matches`),
    ])
      .then(([applicationResult, matchResult]) => { setApplicants(applicationResult.data); setMatches(matchResult.data.candidates); setError(""); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load applicants."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [job.id]);

  const ordered = useMemo(() => {
    const scoreByApplication = new Map(matches.map((match) => [match.applicationId, match]));
    return applicationsSorted(applicants, scoreByApplication);
  }, [applicants, matches]);

  const setStatus = async (applicationId: string, status: string) => {
    setBusyId(applicationId);
    try {
      await api(`/recruiter/applications/${applicationId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setApplicants((current) => current.map((entry) => entry.id === applicationId ? { ...entry, status } : entry));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the application.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="mt-8 border-t border-ink/10 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Applicants</p>
          <h2 className="mt-1.5 font-display text-2xl font-semibold tracking-[-.03em]">{job.title}</h2>
          <p className="mt-1 text-sm text-ink/45">{applicants.length} applicant{applicants.length === 1 ? "" : "s"} · ranked by skills, experience, and description fit.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="chip"><RefreshCw size={13} /> Refresh</button>
          <button type="button" onClick={onClose} className="chip"><X size={13} /> Close</button>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="mt-4 space-y-2">{[0, 1, 2].map((index) => <div key={index} className="h-24 animate-pulse rounded-xl border border-ink/10 bg-ink/[.03]" />)}</div>
      ) : ordered.length ? (
        <div className="mt-4 space-y-3">
          {ordered.map(({ application, match }) => (
            <article key={application.id} className="rounded-xl border border-ink/10 p-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-base font-semibold">{application.user.name}</p>
                    {match && <span className="rounded-md bg-ink/[.06] px-2 py-0.5 text-[10px] font-semibold text-ink/55">{match.scorePercent}% match</span>}
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusTone(application.status)}`}>{statusLabel(application.status)}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink/45">{application.user.email} · {application.user.candidate?.currentRole ?? "Candidate"}{application.user.candidate?.experienceYears != null ? ` · ${application.user.candidate.experienceYears} yrs` : ""}{application.user.candidate?.location ? ` · ${application.user.candidate.location}` : ""}</p>
                  {match && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {match.matchedSkills.slice(0, 6).map((skill) => <span key={skill} className="rounded bg-[#dff1e8] px-1.5 py-0.5 text-[10px] text-[#27634e]">{skill}</span>)}
                      {match.missingRequiredSkills.slice(0, 3).map((skill) => <span key={skill} className="rounded bg-[#f8e0dc] px-1.5 py-0.5 text-[10px] text-[#9a3f33]">missing {skill}</span>)}
                    </div>
                  )}
                  {application.coverLetter && <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink/50">{application.coverLetter}</p>}
                  <p className="mt-2 text-[10px] uppercase tracking-[.1em] text-ink/30">Applied {timeAgo(application.appliedAt)}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <select value={application.status} disabled={busyId === application.id} onChange={(event) => void setStatus(application.id, event.target.value)} className="field !h-9 max-w-40 !text-xs" aria-label={`Status for ${application.user.name}`}>
                    {["SUBMITTED", "IN_REVIEW", "SHORTLISTED", "INTERVIEW", "REJECTED", "OFFERED"].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                  </select>
                  {application.resume && <a href={`/api/v1/recruiter/applications/${application.id}/resume`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ink/50 hover:text-ink"><FileText size={12} /> Resume</a>}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4"><EmptyState icon={<Users size={22} />} title="No applicants yet" description="Applicants appear here as soon as candidates apply to this listing." /></div>
      )}
    </section>
  );
}

function applicationsSorted(applicants: Applicant[], scores: Map<string, CandidateMatch>) {
  return [...applicants]
    .map((application) => ({ application, match: scores.get(application.id) }))
    .sort((left, right) => (right.match?.scorePercent ?? -1) - (left.match?.scorePercent ?? -1));
}

export default function Recruiter() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("overview");
  const [jobs, setJobs] = useState<RecruiterJob[]>([]);
  const [stats, setStats] = useState<RecruiterStats | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [selectedJob, setSelectedJob] = useState("");
  const [editing, setEditing] = useState<RecruiterJob | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyLocation, setCompanyLocation] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [savingCompany, setSavingCompany] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const [jobResult, statsResult, companyResult] = await Promise.all([
        api<Envelope<RecruiterJob[]>>("/recruiter/jobs"),
        api<Envelope<RecruiterStats>>("/recruiter/stats"),
        api<Envelope<Company | null>>("/recruiter/company"),
      ]);
      setJobs(jobResult.data);
      setStats(statsResult.data);
      setCompany(companyResult.data);
      if (companyResult.data) {
        setCompanyName(companyResult.data.name);
        setCompanyWebsite(companyResult.data.website ?? "");
        setCompanyLocation(companyResult.data.location ?? "");
        setCompanyDescription(companyResult.data.description ?? "");
        setCompanyLogoUrl(companyResult.data.logoUrl ?? "");
      }
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the recruiter workspace.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (user?.roles.includes("RECRUITER") || user?.roles.includes("ADMIN")) void load(); }, [user?.id]);

  if (loading) return <main className="shell py-16 text-sm text-ink/50">Loading recruiter workspace…</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.roles.includes("RECRUITER") && !user.roles.includes("ADMIN")) return <Navigate to="/dashboard" replace />;

  const selected = jobs.find((job) => job.id === selectedJob) ?? null;

  const saveCompany = async (event: FormEvent) => {
    event.preventDefault();
    setSavingCompany(true);
    setNotice("");
    setError("");
    try {
      await api("/recruiter/company", { method: "PUT", body: JSON.stringify({ name: companyName, website: companyWebsite || undefined, location: companyLocation || undefined, description: companyDescription || undefined, logoUrl: companyLogoUrl || undefined }) });
      setNotice("Company profile saved.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the company profile.");
    } finally {
      setSavingCompany(false);
    }
  };

  const changeStatus = async (job: RecruiterJob, status: string) => {
    try {
      await api(`/recruiter/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setJobs((current) => current.map((entry) => entry.id === job.id ? { ...entry, status } : entry));
      setNotice(`“${job.title}” is now ${statusLabel(status).toLowerCase()}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the listing.");
    }
  };

  const removeJob = async (job: RecruiterJob) => {
    if (!window.confirm(`Delete “${job.title}”? This cannot be undone.`)) return;
    try {
      await api(`/recruiter/jobs/${job.id}`, { method: "DELETE" });
      setJobs((current) => current.filter((entry) => entry.id !== job.id));
      if (selectedJob === job.id) setSelectedJob("");
      setNotice("Listing deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this listing.");
    }
  };

  return (
    <main className="shell py-10 md:py-14">
      <div className="flex flex-col justify-between gap-5 border-b border-ink/10 pb-8 md:flex-row md:items-end">
        <div>
          <p className="eyebrow"><BriefcaseBusiness size={12} /> Recruiter workspace</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Hire with context.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-ink/55">Publish roles, review ranked applicants, and keep your company profile current. You only see applicants to your own listings.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="button button-coral"><Plus size={15} /> New listing</button>
      </div>

      {notice && <p role="status" className="mt-5 rounded-xl border border-[#2f7a56]/25 bg-[#dff1e8]/60 px-4 py-3 text-sm text-[#27634e]">{notice}</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-300/40 bg-red-50/60 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex flex-wrap gap-1 border-b border-ink/10">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === item.key ? "text-ink" : "text-ink/45 hover:text-ink"}`}>
              <Icon size={14} /> {item.label}
              {tab === item.key && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-coral" />}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <section className="mt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Live listings", value: busy && !stats ? "—" : stats?.published ?? 0, hint: busy && !stats ? "Loading…" : `${stats?.drafts ?? 0} drafts` },
              { label: "Applications", value: busy && !stats ? "—" : stats?.applications ?? 0, hint: busy && !stats ? "Loading…" : `${stats?.applicationsThisWeek ?? 0} this week` },
              { label: "In pipeline", value: busy && !stats ? "—" : stats?.byStatus?.filter((entry) => ["IN_REVIEW", "SHORTLISTED", "INTERVIEW"].includes(entry.status)).reduce((sum, entry) => sum + entry.count, 0) ?? 0, hint: "Review, shortlist, interview" },
              { label: "Closed", value: busy && !stats ? "—" : stats?.closed ?? 0, hint: "Closed or expired" },
            ].map((card) => (
              <div key={card.label} className="stat-card"><p className="eyebrow">{card.label}</p><p className="stat-value">{card.value}</p><p className="mt-1 text-xs text-ink/40">{card.hint}</p></div>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="panel">
              <div className="flex items-end justify-between"><p className="eyebrow">Your listings</p><button type="button" onClick={() => setTab("listings")} className="text-xs text-ink/45 hover:text-ink">Manage all</button></div>
              {busy ? (
                <div className="mt-4 space-y-2">{[0,1,2].map((index) => <div key={index} className="h-16 animate-pulse rounded-xl border border-ink/10 bg-ink/[.03]" />)}</div>
              ) : jobs.length ? (
                <div className="mt-4 space-y-2">
                  {jobs.slice(0, 5).map((job) => (
                    <button key={job.id} type="button" onClick={() => { setSelectedJob(job.id); setTab("listings"); }} className="flex w-full items-center gap-3 rounded-xl border border-ink/10 p-3 text-left transition-colors hover:border-ink/25">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{job.title}</span>
                        <span className="block text-xs text-ink/45">{job.location} · {job._count.applications} applicant{job._count.applications === 1 ? "" : "s"}</span>
                      </span>
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${job.status === "PUBLISHED" ? "bg-[#dff1e8] text-[#27634e]" : "bg-ink/[.06] text-ink/50"}`}>{statusLabel(job.status)}</span>
                    </button>
                  ))}
                </div>
              ) : <p className="mt-4 text-sm text-ink/45">Create your first listing to start receiving applicants.</p>}
            </div>

            <div className="panel">
              <p className="eyebrow">Hiring pipeline</p>
              {stats?.byStatus?.length ? (
                <div className="mt-4 space-y-3">
                  {stats.byStatus.map((entry) => {
                    const max = Math.max(...stats.byStatus.map((item) => item.count), 1);
                    return <div key={entry.status}><div className="flex items-center justify-between text-xs"><span className="text-ink/55">{statusLabel(entry.status)}</span><span className="mono text-ink/40">{entry.count}</span></div><Progress value={(entry.count / max) * 100} className="mt-1.5" tone={entry.status === "REJECTED" ? "ink" : entry.status === "OFFERED" ? "green" : "coral"} /></div>;
                  })}
                </div>
              ) : <p className="mt-3 text-sm text-ink/45">No applications yet.</p>}
              <div className="mt-5 rounded-lg bg-secondary/60 p-3 text-[11px] leading-5 text-ink/50">
                Applicant ranking uses required skills, experience, and a local text comparison. You remain responsible for every hiring decision.
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "listings" && (
        <section className="mt-6">
          {busy ? (
            <div className="space-y-3">{[0, 1, 2].map((index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-ink/10 bg-ink/[.03]" />)}</div>
          ) : jobs.length ? (
            <div className="space-y-3">
              {jobs.map((job) => (
                <article key={job.id} className="panel !p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/jobs/${job.id}`} className="font-display text-lg font-semibold tracking-[-.02em] hover:text-coral">{job.title}</Link>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${job.status === "PUBLISHED" ? "bg-[#dff1e8] text-[#27634e]" : job.status === "DRAFT" ? "bg-[#f3ecd3] text-[#7d6220]" : "bg-ink/[.06] text-ink/50"}`}>{statusLabel(job.status)}</span>
                      </div>
                      <p className="mt-1 text-sm text-ink/45">{job.company?.name} · {job.location} · {job.employmentType}</p>
                      <p className="mt-1 text-xs text-ink/40">{job._count.applications} application{job._count.applications === 1 ? "" : "s"} · published {job.publishedAt ? formatDate(job.publishedAt) : "not yet"} · {job.skills.map((skill) => skill.name).join(", ")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <button type="button" onClick={() => setSelectedJob(job.id === selectedJob ? "" : job.id)} className="inline-flex items-center gap-1 text-ink/55 hover:text-ink"><Users size={13} /> Applicants</button>
                      <button type="button" onClick={() => setEditing(job)} className="inline-flex items-center gap-1 text-ink/55 hover:text-ink"><Pencil size={13} /> Edit</button>
                      {job.status === "PUBLISHED" ? <button type="button" onClick={() => void changeStatus(job, "CLOSED")} className="text-ink/55 hover:text-ink">Close</button> : <button type="button" onClick={() => void changeStatus(job, "PUBLISHED")} className="text-[#27634e] hover:underline">Publish</button>}
                      <button type="button" onClick={() => void removeJob(job)} className="text-ink/35 hover:text-red-600" aria-label={`Delete ${job.title}`}><Trash2 size={13} /></button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={<BriefcaseBusiness size={22} />} title="No listings yet" description="Create your first opportunity. You can save it as a draft and publish when it is ready." actionLabel="Create a listing" onAction={() => setCreating(true)} />
          )}

          {selected && <ApplicantsPanel job={selected} onClose={() => setSelectedJob("")} />}
        </section>
      )}

      {tab === "company" && (
        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <form onSubmit={saveCompany} className="panel">
            <p className="eyebrow">Company profile</p>
            <p className="mt-1 text-sm text-ink/45">This appears on your listings and the public company page.</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="input-label md:col-span-2">Company name<input className="field mt-2" required value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
              <label className="input-label">Website<input className="field mt-2" type="url" placeholder="https://" value={companyWebsite} onChange={(event) => setCompanyWebsite(event.target.value)} /></label>
              <label className="input-label">Location<input className="field mt-2" value={companyLocation} onChange={(event) => setCompanyLocation(event.target.value)} /></label>
              <label className="input-label md:col-span-2">Logo URL <span className="font-normal text-ink/35">(optional)</span><input className="field mt-2" type="url" placeholder="https://…/logo.png" value={companyLogoUrl} onChange={(event) => setCompanyLogoUrl(event.target.value)} /></label>
              <label className="input-label md:col-span-2">About the company<textarea className="field-lg mt-2" value={companyDescription} onChange={(event) => setCompanyDescription(event.target.value)} /></label>
            </div>
            <button disabled={savingCompany} className="button button-dark mt-5">{savingCompany ? "Saving…" : "Save company profile"}</button>
          </form>

          <div className="panel">
            <p className="eyebrow">Public preview</p>
            <div className="mt-4 flex items-center gap-3">
              <CompanyLogo name={companyName || company?.name || "Company"} logoUrl={companyLogoUrl || company?.logoUrl} size="lg" />
              <div><p className="font-display text-lg font-semibold">{companyName || company?.name || "Your company"}</p><p className="text-xs text-ink/45">{companyLocation || "Location"}</p></div>
            </div>
            <p className="mt-4 line-clamp-6 text-sm leading-6 text-ink/55">{companyDescription || "Add a short description so candidates understand what your team builds and how it works."}</p>
            {company?.id && <Link to={`/companies/${company.id}`} className="button button-outline mt-5 w-full !py-2.5 text-xs">View public page</Link>}
          </div>
        </section>
      )}

      {(creating || editing) && <ListingModal job={editing} needsCompany={!company?.id} onClose={() => { setCreating(false); setEditing(null); }} onSaved={load} />}
    </main>
  );
}
