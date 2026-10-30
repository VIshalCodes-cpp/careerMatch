import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ArrowRight, Bell, Bookmark, BriefcaseBusiness, CheckCircle2, FileText, Plus, Sparkles, TrendingUp, UserRound,
} from "lucide-react";
import JobCard from "@/components/JobCard";
import Progress from "@/components/Progress";
import EmptyState from "@/components/EmptyState";
import CompanyLogo from "@/components/CompanyLogo";
import { useAuth } from "@/context/AuthContext";
import { api, Envelope } from "@/lib/api";
import { statusLabel, statusTone, timeAgo } from "@/lib/format";
import type { ApplicationRecord, Job, NotificationRecord, Overview } from "@/lib/types";

export default function Dashboard() {
  const { user, loading } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [saved, setSaved] = useState<Job[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [recLoading, setRecLoading] = useState(true);

  useEffect(() => {
    if (!user?.roles.includes("CANDIDATE")) return;
    setBusy(true);
    Promise.all([
      api<Envelope<Overview>>("/me/overview"),
      api<Envelope<Job[]>>("/me/saved-jobs"),
      api<Envelope<ApplicationRecord[]>>("/me/applications"),
      api<Envelope<{ items: NotificationRecord[]; unread: number }>>("/me/notifications?limit=4"),
    ])
      .then(([overviewResult, savedJobs, apps, notificationResult]) => {
        setOverview(overviewResult.data);
        setSaved(savedJobs.data);
        setApplications(apps.data);
        setNotifications(notificationResult.data.items);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load your dashboard."))
      .finally(() => setBusy(false));

    // Ranking is heavier than the summary queries; load it independently so the
    // rest of the workspace becomes usable first.
    setRecLoading(true);
    api<Envelope<{ recommendations: Job[]; notice?: string }>>("/recommendations/jobs?limit=6")
      .then((recommendations) => {
        setJobs(recommendations.data.recommendations ?? []);
        setNotice(recommendations.data.notice ?? "");
      })
      .catch(() => undefined)
      .finally(() => setRecLoading(false));
  }, [user?.id]);

  if (loading) return <main className="shell py-16 text-sm text-ink/50">Loading your workspace…</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.roles.includes("CANDIDATE")) return <Navigate to={user.roles.includes("ADMIN") ? "/admin" : "/recruiter"} replace />;

  const candidate = overview?.candidate;
  const completeness = candidate?.profileComplete ?? 0;
  const firstName = user.name.split(" ")[0];
  const activeApps = candidate?.activeApplications ?? applications.filter((application) => !["WITHDRAWN", "REJECTED"].includes(application.status)).length;

  const checklist = [
    { done: Boolean(candidate?.hasProfile), label: "Candidate profile created", to: "/profile", action: "Complete profile" },
    { done: (candidate?.skills ?? 0) > 0, label: "Skills added", to: "/profile", action: "Add skills" },
    { done: (candidate?.resumes ?? 0) > 0, label: "Resume uploaded", to: "/profile", action: "Upload resume" },
    { done: (candidate?.savedJobs ?? 0) > 0, label: "First job saved", to: "/jobs", action: "Browse jobs" },
    { done: (candidate?.applications ?? 0) > 0, label: "First application sent", to: "/jobs", action: "Apply" },
  ];

  return (
    <main className="shell py-10 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-ink/10 pb-9">
        <div>
          <p className="eyebrow"><span className="size-1.5 rounded-full bg-coral" /> Candidate dashboard</p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Good to see you, {firstName}.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-ink/55">
            Your matches, saved roles, and applications in one place. Scores compare your profile with live listings — they are not hiring probabilities.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/jobs" className="button button-dark"><Plus size={15} /> Find jobs</Link>
          <Link to="/profile" className="button button-outline"><UserRound size={15} /> Edit profile</Link>
        </div>
      </div>

      {error && <p role="alert" className="mt-6 rounded-xl border border-red-300/40 bg-red-50/60 p-4 text-sm text-red-700">{error}</p>}

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <p className="eyebrow"><Sparkles size={11} /> Recommended</p>
          <p className="stat-value">{recLoading && !jobs.length ? "—" : jobs.length || candidate?.recommendationCount || 0}</p>
          <p className="mt-1 text-xs text-ink/40">Ranked against your profile</p>
        </div>
        <Link to="/saved" className="stat-card transition-colors hover:border-ink/25">
          <p className="eyebrow"><Bookmark size={11} /> Saved</p>
          <p className="stat-value">{busy && !candidate ? "—" : candidate?.savedJobs ?? saved.length}</p>
          <p className="mt-1 text-xs text-ink/40">Roles you want to revisit</p>
        </Link>
        <Link to="/applications" className="stat-card transition-colors hover:border-ink/25">
          <p className="eyebrow"><BriefcaseBusiness size={11} /> Active applications</p>
          <p className="stat-value">{busy && !candidate ? "—" : activeApps}</p>
          <p className="mt-1 text-xs text-ink/40">{candidate?.applications ?? applications.length} total submitted</p>
        </Link>
        <Link to="/notifications" className="stat-card transition-colors hover:border-ink/25">
          <p className="eyebrow"><Bell size={11} /> Notifications</p>
          <p className="stat-value">{busy && !overview ? "—" : overview?.unreadNotifications ?? 0}</p>
          <p className="mt-1 text-xs text-ink/40">Unread updates</p>
        </Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <section>
            <div className="flex items-end justify-between">
              <div>
                <p className="eyebrow">Based on your profile</p>
                <h2 className="mt-2 section-title">Recommended opportunities</h2>
              </div>
              <Link to="/jobs" className="flex items-center gap-1.5 text-sm text-ink/50 hover:text-ink">Browse all <ArrowRight size={14} /></Link>
            </div>

            {recLoading ? (
              <div className="mt-5 space-y-3">{[0, 1, 2].map((index) => <div key={index} className="h-32 animate-pulse rounded-2xl border border-ink/10 bg-ink/[.03]" />)}</div>
            ) : jobs.length ? (
              <div className="mt-5 space-y-3">
                {jobs.map((job, index) => <JobCard key={job.id} job={job} rank={index + 1} />)}
              </div>
            ) : (
              <div className="mt-5">
                <EmptyState
                  icon={<Sparkles size={22} />}
                  title={notice || "Add profile skills to see matches"}
                  description="Complete your profile with skills, experience, and preferences. Recommendations refresh as soon as recruiters publish roles."
                  actionLabel="Complete profile"
                  actionTo="/profile"
                />
              </div>
            )}
          </section>

          <section className="mt-12 grid gap-6 md:grid-cols-2">
            <div>
              <div className="flex items-end justify-between">
                <h2 className="section-title flex items-center gap-2 !text-xl"><Bookmark size={17} /> Saved jobs</h2>
                <Link to="/saved" className="text-xs text-ink/45 hover:text-ink">View all</Link>
              </div>
              {saved.length ? (
                <div className="mt-4 space-y-2">
                  {saved.slice(0, 4).map((job) => (
                    <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center gap-3 rounded-xl border border-ink/10 p-3 transition-colors hover:border-ink/25">
                      <CompanyLogo name={job.company?.name} logoUrl={job.company?.logoUrl} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{job.title}</span>
                        <span className="block truncate text-xs text-ink/45">{job.company?.name} · {job.location}</span>
                      </span>
                      <ArrowRight size={14} className="shrink-0 text-ink/30" />
                    </Link>
                  ))}
                </div>
              ) : <p className="mt-4 rounded-xl border border-dashed border-ink/15 p-5 text-sm text-ink/45">Saved roles appear here. Press the bookmark on any listing.</p>}
            </div>

            <div>
              <div className="flex items-end justify-between">
                <h2 className="section-title flex items-center gap-2 !text-xl"><BriefcaseBusiness size={17} /> Applications</h2>
                <Link to="/applications" className="text-xs text-ink/45 hover:text-ink">View all</Link>
              </div>
              {applications.length ? (
                <div className="mt-4 space-y-2">
                  {applications.slice(0, 4).map((application) => (
                    <Link key={application.id} to={`/jobs/${application.job.id}`} className="flex items-center gap-3 rounded-xl border border-ink/10 p-3 transition-colors hover:border-ink/25">
                      <CompanyLogo name={application.job.company?.name} logoUrl={application.job.company?.logoUrl} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{application.job.title}</span>
                        <span className="block text-xs text-ink/45">{application.job.company?.name} · {timeAgo(application.appliedAt)}</span>
                      </span>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusTone(application.status)}`}>{statusLabel(application.status)}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="mt-4 rounded-xl border border-dashed border-ink/15 p-5 text-sm text-ink/45">No applications yet. Apply to a direct listing to track its status here.</p>}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="panel">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Profile strength</p>
              <span className="text-sm font-semibold text-coral">{completeness}%</span>
            </div>
            <Progress value={completeness} className="mt-3" tone={completeness >= 80 ? "green" : "coral"} />
            <p className="mt-2 text-xs leading-5 text-ink/45">
              {completeness >= 80 ? "Your profile has the detail recruiters and matching need." : "A complete profile improves rankings and gives recruiters context."}
            </p>
            <div className="mt-4 space-y-2.5">
              {checklist.map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  <span className={`grid size-5 shrink-0 place-items-center rounded-full ${item.done ? "bg-[#dff1e8] text-[#27634e]" : "border border-dashed border-ink/20 text-ink/25"}`}>
                    {item.done ? <CheckCircle2 size={12} /> : <span className="size-1 rounded-full bg-current" />}
                  </span>
                  <span className={item.done ? "text-ink/45 line-through" : "text-ink/65"}>{item.label}</span>
                  {!item.done && <Link to={item.to} className="ml-auto text-[10px] text-coral hover:underline">{item.action}</Link>}
                </div>
              ))}
            </div>
            <Link to="/profile" className="button button-outline mt-5 w-full !py-2.5 text-xs"><FileText size={13} /> Open profile</Link>
          </div>

          <div className="panel">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Recent activity</p>
              <Link to="/notifications" className="text-[10px] text-ink/40 hover:text-ink">See all</Link>
            </div>
            {notifications.length ? (
              <ul className="mt-3 space-y-3">
                {notifications.map((notification) => (
                  <li key={notification.id} className="flex gap-2.5">
                    <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${notification.readAt ? "bg-ink/15" : "bg-coral"}`} />
                    <div>
                      <p className="text-xs font-medium leading-5">{notification.title}</p>
                      <p className="text-[11px] leading-4 text-ink/45">{notification.message}</p>
                      <p className="mt-0.5 text-[10px] text-ink/30">{timeAgo(notification.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-xs leading-5 text-ink/40">Application updates and recruiter activity will show up here.</p>}
          </div>

          <div className="rounded-2xl border border-ink/10 bg-secondary/60 p-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><TrendingUp size={13} className="text-coral" /> Looking ahead?</p>
            <p className="mt-2 text-xs leading-5 text-ink/50">Explore documented role transitions and the skills that bridge them.</p>
            <Link to="/career-path" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink hover:text-coral">Open career paths <ArrowRight size={12} /></Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
