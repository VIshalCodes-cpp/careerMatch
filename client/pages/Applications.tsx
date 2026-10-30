import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { BriefcaseBusiness, Check, CheckCircle2, ChevronDown, ExternalLink, FileText, XCircle } from "lucide-react";
import CompanyLogo from "@/components/CompanyLogo";
import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { api, Envelope } from "@/lib/api";
import { APPLICATION_STAGES, applicationStageIndex, formatDate, statusLabel, statusTone } from "@/lib/format";
import type { ApplicationRecord } from "@/lib/types";

const STAGE_LABELS: Record<string, string> = { SUBMITTED: "Submitted", IN_REVIEW: "In review", SHORTLISTED: "Shortlisted", INTERVIEW: "Interview", OFFERED: "Offer" };

function StageTimeline({ status }: { status: string }) {
  const activeIndex = applicationStageIndex(status);
  if (activeIndex < 0) {
    return (
      <p className={`mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${statusTone(status)}`}>
        {status === "WITHDRAWN" ? <XCircle size={12} /> : <XCircle size={12} />} {status === "WITHDRAWN" ? "You withdrew this application" : "Not selected this time"}
      </p>
    );
  }
  return (
    <ol className="mt-4 flex items-center gap-1">
      {APPLICATION_STAGES.map((stage, index) => {
        const reached = index <= activeIndex;
        return (
          <li key={stage} className="flex flex-1 items-center gap-1">
            <span className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-medium ${reached ? "text-ink/75" : "text-ink/30"}`}>
              <span className={`grid size-4 shrink-0 place-items-center rounded-full ${reached ? "bg-[#2f7a56] text-white" : "border border-ink/15 bg-transparent"}`}>
                {reached ? <Check size={9} /> : <span className="size-1 rounded-full bg-current" />}
              </span>
              <span className="hidden truncate sm:inline">{STAGE_LABELS[stage]}</span>
            </span>
            {index < APPLICATION_STAGES.length - 1 && <span className={`h-px flex-1 ${index < activeIndex ? "bg-[#2f7a56]/40" : "bg-ink/10"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export default function Applications() {
  const { user, loading } = useAuth();
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"active" | "closed">("active");

  useEffect(() => {
    if (!user?.roles.includes("CANDIDATE")) return;
    api<Envelope<ApplicationRecord[]>>("/me/applications")
      .then((result) => setApplications(result.data))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load applications."))
      .finally(() => setFetching(false));
  }, [user?.id]);

  const { active, closed } = useMemo(() => ({
    active: applications.filter((application) => !["WITHDRAWN", "REJECTED"].includes(application.status)),
    closed: applications.filter((application) => ["WITHDRAWN", "REJECTED"].includes(application.status)),
  }), [applications]);

  if (loading) return <main className="shell py-16 text-sm text-ink/50">Loading applications…</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.roles.includes("CANDIDATE")) return <Navigate to="/recruiter" replace />;

  const withdraw = async (application: ApplicationRecord) => {
    if (!window.confirm(`Withdraw your application for ${application.job.title}?`)) return;
    setError("");
    try {
      await api(`/me/applications/${application.id}`, { method: "DELETE" });
      setApplications((current) => current.map((entry) => entry.id === application.id ? { ...entry, status: "WITHDRAWN" } : entry));
      setNotice("Application withdrawn.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not withdraw this application.");
    }
  };

  const shown = tab === "active" ? active : closed;

  return (
    <main className="shell py-10 md:py-16">
      <div className="flex flex-col justify-between gap-5 border-b border-ink/10 pb-8 md:flex-row md:items-end">
        <div>
          <p className="eyebrow"><BriefcaseBusiness size={12} /> Application tracker</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Every application, in one place.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-ink/55">Follow stages from submitted to offer. Partner applications are recorded here too, even though you finish them on the employer's site.</p>
        </div>
        <Link to="/jobs" className="button button-dark">Find more roles</Link>
      </div>

      {notice && <p role="status" className="mt-6 rounded-xl border border-[#2f7a56]/25 bg-[#dff1e8]/60 px-4 py-3 text-sm text-[#27634e]">{notice}</p>}
      {error && <p role="alert" className="mt-6 rounded-xl border border-red-300/40 bg-red-50/60 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex gap-1 border-b border-ink/10">
        {[
          { key: "active" as const, label: "Active", count: active.length },
          { key: "closed" as const, label: "Closed", count: closed.length },
        ].map((item) => (
          <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${tab === item.key ? "text-ink" : "text-ink/45 hover:text-ink"}`}>
            {item.label} <span className="ml-1 rounded-full bg-ink/[.07] px-1.5 py-0.5 text-[10px]">{item.count}</span>
            {tab === item.key && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-coral" />}
          </button>
        ))}
      </div>

      {fetching ? (
        <div className="mt-6 space-y-3">{[0, 1, 2].map((index) => <div key={index} className="h-40 animate-pulse rounded-2xl border border-ink/10 bg-ink/[.03]" />)}</div>
      ) : shown.length ? (
        <div className="mt-6 space-y-3">
          {shown.map((application) => {
            const external = Boolean(application.job.applyUrl);
            return (
              <article key={application.id} className="panel">
                <div className="flex flex-wrap items-start gap-4">
                  <CompanyLogo name={application.job.company?.name} logoUrl={application.job.company?.logoUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/jobs/${application.job.id}`} className="font-display text-lg font-semibold tracking-[-.02em] hover:text-coral">{application.job.title}</Link>
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusTone(application.status)}`}>{statusLabel(application.status)}</span>
                      {external && <span className="inline-flex items-center gap-1 rounded-md bg-ink/[.06] px-2 py-0.5 text-[10px] text-ink/45"><ExternalLink size={10} /> {application.job.sourceName ?? "Employer site"}</span>}
                    </div>
                    <p className="mt-1 text-sm text-ink/50">{application.job.company?.name} · {application.job.location}</p>
                    <p className="mt-1 text-xs text-ink/40">Applied {formatDate(application.appliedAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {application.resume && <a href={`/api/v1/me/resumes/${application.resume.id}/download`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink/50 hover:text-ink"><FileText size={12} /> {application.resume.originalName}</a>}
                    {!["WITHDRAWN", "REJECTED", "OFFERED"].includes(application.status) && (
                      <button type="button" onClick={() => void withdraw(application)} className="text-ink/40 hover:text-red-600">Withdraw</button>
                    )}
                  </div>
                </div>

                <StageTimeline status={application.status} />

                {application.coverLetter && (
                  <details className="group mt-4 border-t border-ink/10 pt-3">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-ink/45 hover:text-ink">
                      <ChevronDown size={13} className="transition-transform group-open:rotate-180" /> Your note to the recruiter
                    </summary>
                    <p className="mt-2 whitespace-pre-line rounded-lg bg-secondary/50 p-3 text-xs leading-6 text-ink/60">{application.coverLetter}</p>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={<BriefcaseBusiness size={22} />}
            title={tab === "active" ? "No active applications" : "No closed applications"}
            description={tab === "active" ? "Apply to a direct listing to start a tracked application. Partner listings appear here after you click through." : "Withdrawn and rejected applications stay here for your records."}
            actionLabel="Browse opportunities"
            actionTo="/jobs"
          />
        </div>
      )}

      <div className="mt-10 flex items-start gap-2 rounded-xl border border-ink/10 p-4 text-xs leading-5 text-ink/40">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-coral" />
        <p>Statuses are updated by the recruiter who owns the listing. If a role was applied to on an external site, update your own records there as well.</p>
      </div>
    </main>
  );
}
