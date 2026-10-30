import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  Activity, BriefcaseBusiness, Building2, CheckCircle2, FileClock, RefreshCw, ShieldCheck, Users, XCircle,
} from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { api, Envelope } from "@/lib/api";
import { formatDate, statusLabel, statusTone, timeAgo } from "@/lib/format";
import type { PaginationMeta } from "@/lib/types";

type AdminStats = { users: number; candidates: number; recruiters: number; admins: number; companies: number; jobs: number; publishedJobs: number; externalJobs: number; recruiterJobs: number; applications: number; applicationsToday: number; applicationsThisWeek: number; resumes: number; recommendations: number };
type AdminJob = { id: string; title: string; status: string; source: string; sourceName?: string | null; location: string; createdAt: string; publishedAt?: string | null; company: { id: string; name: string }; createdBy: { id: string; email: string; name: string }; _count: { applications: number } };
type AdminUser = { id: string; name: string; email: string; emailVerifiedAt?: string | null; disabledAt?: string | null; createdAt: string; roles: { role: string }[]; _count: { applications: number; jobsCreated: number; resumes: number } };
type AuditEntry = { id: string; action: string; targetType: string; targetId?: string | null; createdAt: string; metadata?: any; actor?: { name: string; email: string } | null };

const TABS = [
  { key: "overview", label: "Overview", icon: Activity },
  { key: "jobs", label: "Listings", icon: BriefcaseBusiness },
  { key: "users", label: "Accounts", icon: Users },
  { key: "audit", label: "Audit log", icon: FileClock },
] as const;

export default function Admin() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [jobMeta, setJobMeta] = useState<PaginationMeta | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userMeta, setUserMeta] = useState<PaginationMeta | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [jobQuery, setJobQuery] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadStats = () => api<Envelope<AdminStats>>("/admin/stats").then((result) => setStats(result.data)).catch((reason) => setError(reason.message));

  const loadJobs = (query = jobQuery, status = jobStatus) => {
    const params = new URLSearchParams({ limit: "25" });
    if (query.trim()) params.set("q", query.trim());
    if (status) params.set("status", status);
    return api<{ data: AdminJob[]; meta: PaginationMeta }>(`/admin/jobs?${params}`).then((result) => { setJobs(result.data); setJobMeta(result.meta); }).catch((reason) => setError(reason.message));
  };

  const loadUsers = (query = userQuery) => {
    const params = new URLSearchParams({ limit: "25" });
    if (query.trim()) params.set("q", query.trim());
    return api<{ data: AdminUser[]; meta: PaginationMeta }>(`/admin/users?${params}`).then((result) => { setUsers(result.data); setUserMeta(result.meta); }).catch((reason) => setError(reason.message));
  };

  const loadAudit = () => api<Envelope<AuditEntry[]>>("/admin/audit").then((result) => setAudit(result.data)).catch((reason) => setError(reason.message));

  useEffect(() => {
    if (!user?.roles.includes("ADMIN")) return;
    setBusy(true);
    Promise.all([loadStats(), loadJobs(), loadUsers(), loadAudit()]).finally(() => setBusy(false));
  }, [user?.id]);

  useEffect(() => { if (tab === "jobs") void loadJobs(); }, [tab, jobStatus]);
  useEffect(() => { if (tab === "users") void loadUsers(); }, [tab]);
  useEffect(() => { if (tab === "audit") void loadAudit(); }, [tab]);

  if (loading) return <main className="shell py-16 text-sm text-ink/50">Loading admin workspace…</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.roles.includes("ADMIN")) {
    return (
      <main className="shell py-20">
        <div className="mx-auto max-w-lg rounded-2xl border border-ink/10 p-8 text-center">
          <ShieldCheck size={28} className="mx-auto text-coral" />
          <h1 className="mt-4 font-display text-2xl font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-ink/55">This account does not have the ADMIN role. Ask an existing admin to grant it, or use the bootstrap endpoint configured for your deployment.</p>
          <Link to="/dashboard" className="button button-dark mt-6">Back to dashboard</Link>
        </div>
      </main>
    );
  }

  const syncJobs = async () => {
    setSyncing(true);
    setNotice("");
    setError("");
    try {
      const result = await api<Envelope<{ fetched: number; created: number; updated: number; providers: Record<string, number>; durationMs: number }>>("/admin/jobs/sync", { method: "POST" });
      const breakdown = Object.entries(result.data.providers ?? {})
        .filter(([, count]) => count > 0)
        .map(([name, count]) => `${count} ${name}`)
        .join(" · ");
      setNotice(`Feed refresh finished: ${result.data.created} new, ${result.data.updated} updated${breakdown ? ` (${breakdown})` : ""}.`);
      await Promise.all([loadStats(), loadJobs()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not refresh the public job feeds.");
    } finally {
      setSyncing(false);
    }
  };

  const setJobStatusTo = async (job: AdminJob, status: string) => {
    try {
      await api(`/admin/jobs/${job.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setJobs((current) => current.map((entry) => entry.id === job.id ? { ...entry, status } : entry));
      setNotice(`“${job.title}” is now ${statusLabel(status).toLowerCase()}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this listing.");
    }
  };

  const toggleUser = async (account: AdminUser) => {
    const disabled = !account.disabledAt;
    try {
      await api(`/admin/users/${account.id}/disable`, { method: "PATCH", body: JSON.stringify({ disabled }) });
      setUsers((current) => current.map((entry) => entry.id === account.id ? { ...entry, disabledAt: disabled ? new Date().toISOString() : null } : entry));
      setNotice(`${account.name} ${disabled ? "disabled" : "re-enabled"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this account.");
    }
  };

  const toggleRole = async (account: AdminUser, role: string) => {
    const hasRole = account.roles.some((entry) => entry.role === role);
    try {
      if (hasRole) await api(`/admin/users/${account.id}/roles/${role}`, { method: "DELETE" });
      else await api(`/admin/users/${account.id}/roles/${role}`, { method: "PUT" });
      setUsers((current) => current.map((entry) => entry.id === account.id ? { ...entry, roles: hasRole ? entry.roles.filter((item) => item.role !== role) : [...entry.roles, { role }] } : entry));
      setNotice(`${role} ${hasRole ? "revoked from" : "granted to"} ${account.name}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update roles.");
    }
  };

  return (
    <main className="shell py-10 md:py-14">
      <div className="flex flex-col justify-between gap-5 border-b border-ink/10 pb-8 md:flex-row md:items-end">
        <div>
          <p className="eyebrow"><ShieldCheck size={12} /> Admin</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Marketplace control room.</h1>
          <p className="mt-3 text-sm text-ink/55">Moderate listings, manage accounts and roles, and keep the public feeds fresh.</p>
        </div>
        <button type="button" onClick={() => void syncJobs()} disabled={syncing} className="button button-coral">
          <RefreshCw size={15} className={syncing ? "animate-spin" : ""} /> {syncing ? "Refreshing feeds…" : "Refresh public feeds"}
        </button>
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
              { label: "Accounts", value: stats?.users, hint: busy && !stats ? "Loading…" : `${stats?.candidates ?? 0} candidates · ${stats?.recruiters ?? 0} recruiters`, icon: Users },
              { label: "Published roles", value: stats?.publishedJobs, hint: busy && !stats ? "Loading…" : `${stats?.externalJobs ?? 0} from public feeds`, icon: BriefcaseBusiness },
              { label: "Companies", value: stats?.companies, hint: busy && !stats ? "Loading…" : `${stats?.recruiterJobs ?? 0} direct listings`, icon: Building2 },
              { label: "Applications", value: stats?.applications, hint: busy && !stats ? "Loading…" : `${stats?.applicationsToday ?? 0} today`, icon: Activity },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="stat-card">
                  <div className="flex items-center justify-between"><p className="eyebrow">{card.label}</p><Icon size={15} className="text-coral" /></div>
                  <p className="stat-value">{busy && stats == null ? "—" : card.value?.toLocaleString() ?? "—"}</p>
                  <p className="mt-1 text-xs text-ink/40">{card.hint}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="panel">
              <p className="eyebrow">Marketplace health</p>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  ["Published roles", stats?.publishedJobs],
                  ["Draft / closed", stats ? stats.jobs - stats.publishedJobs : null],
                  ["Applications this week", stats?.applicationsThisWeek],
                  ["Resumes uploaded", stats?.resumes],
                  ["Recommendation rows", stats?.recommendations],
                  ["Admins", stats?.admins],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between border-b border-ink/[.07] pb-2 last:border-0 last:pb-0">
                    <dt className="text-ink/50">{label}</dt><dd className="mono font-semibold">{value ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="panel">
              <p className="eyebrow">Recent audit events</p>
              {audit.length ? (
                <ul className="mt-4 space-y-3">
                  {audit.slice(0, 6).map((entry) => (
                    <li key={entry.id} className="flex items-start gap-2.5 text-xs">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-coral" />
                      <div>
                        <p className="font-medium text-ink/70">{entry.action.replace(/_/g, " ").toLowerCase()}</p>
                        <p className="text-ink/40">{entry.actor?.name ?? "System"} · {entry.targetType} · {timeAgo(entry.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-sm text-ink/45">No audit events yet.</p>}
            </div>
          </div>
        </section>
      )}

      {tab === "jobs" && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <input value={jobQuery} onChange={(event) => setJobQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void loadJobs()} className="field max-w-xs !h-10" placeholder="Search title or company" aria-label="Search listings" />
            <select value={jobStatus} onChange={(event) => setJobStatus(event.target.value)} className="field max-w-40 !h-10" aria-label="Filter status">
              <option value="">All statuses</option>
              {["DRAFT", "PUBLISHED", "CLOSED", "EXPIRED"].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
            </select>
            <button type="button" onClick={() => void loadJobs()} className="chip">Apply filters</button>
            <span className="text-xs text-ink/40">{jobMeta?.total ?? jobs.length} listings</span>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/10">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="table-head"><tr><th className="px-4 py-3">Role</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Applicants</th><th className="px-4 py-3">Created</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-ink/[.07]">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-ink/[.02]">
                    <td className="max-w-72 px-4 py-3"><Link to={`/jobs/${job.id}`} className="block truncate font-medium hover:text-coral">{job.title}</Link><span className="text-xs text-ink/40">{job.company.name} · {job.location}</span></td>
                    <td className="px-4 py-3 text-xs text-ink/50">{job.source === "EXTERNAL" ? job.sourceName ?? "External" : "Direct"}</td>
                    <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${job.status === "PUBLISHED" ? "bg-[#dff1e8] text-[#27634e]" : job.status === "DRAFT" ? "bg-[#f3ecd3] text-[#7d6220]" : "bg-ink/[.06] text-ink/50"}`}>{statusLabel(job.status)}</span></td>
                    <td className="px-4 py-3 text-xs text-ink/50">{job._count.applications}</td>
                    <td className="px-4 py-3 text-xs text-ink/40">{formatDate(job.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {job.status !== "PUBLISHED" ? <button type="button" onClick={() => void setJobStatusTo(job, "PUBLISHED")} className="text-xs text-[#27634e] hover:underline">Publish</button> : <button type="button" onClick={() => void setJobStatusTo(job, "CLOSED")} className="text-xs text-ink/50 hover:underline">Close</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!jobs.length && <p className="p-6 text-center text-sm text-ink/45">No listings match these filters.</p>}
          </div>
        </section>
      )}

      {tab === "users" && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void loadUsers()} className="field max-w-xs !h-10" placeholder="Search name or email" aria-label="Search accounts" />
            <button type="button" onClick={() => void loadUsers()} className="chip">Search</button>
            <span className="text-xs text-ink/40">{userMeta?.total ?? users.length} accounts</span>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/10">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="table-head"><tr><th className="px-4 py-3">Account</th><th className="px-4 py-3">Roles</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Manage</th></tr></thead>
              <tbody className="divide-y divide-ink/[.07]">
                {users.map((account) => (
                  <tr key={account.id} className="hover:bg-ink/[.02]">
                    <td className="px-4 py-3"><p className="font-medium">{account.name}</p><p className="text-xs text-ink/40">{account.email}</p></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {["CANDIDATE", "RECRUITER", "ADMIN"].map((role) => {
                          const active = account.roles.some((entry) => entry.role === role);
                          return <button key={role} type="button" onClick={() => void toggleRole(account, role)} className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${active ? "bg-ink text-paper" : "border border-ink/15 text-ink/35 hover:border-ink/35 hover:text-ink/60"}`} title={`${active ? "Revoke" : "Grant"} ${role}`}>{role}</button>;
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/45">{account._count.applications} app{account._count.applications === 1 ? "" : "s"} · {account._count.jobsCreated} job{account._count.jobsCreated === 1 ? "" : "s"} · {account._count.resumes} resume{account._count.resumes === 1 ? "" : "s"}</td>
                    <td className="px-4 py-3 text-xs text-ink/40">{formatDate(account.createdAt)}</td>
                    <td className="px-4 py-3">{account.disabledAt ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><XCircle size={11} /> Disabled</span> : <span className="inline-flex items-center gap-1 text-xs text-[#27634e]"><CheckCircle2 size={11} /> Active</span>}</td>
                    <td className="px-4 py-3 text-right"><button type="button" onClick={() => void toggleUser(account)} className="text-xs text-ink/50 underline underline-offset-2 hover:text-red-600">{account.disabledAt ? "Re-enable" : "Disable"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!users.length && <p className="p-6 text-center text-sm text-ink/45">No accounts match this search.</p>}
          </div>
        </section>
      )}

      {tab === "audit" && (
        <section className="mt-6">
          {audit.length ? (
            <div className="divide-y divide-ink/[.07] overflow-hidden rounded-2xl border border-ink/10">
              {audit.map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-ink/[.02]">
                  <span className="rounded bg-ink/[.06] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink/50">{entry.action}</span>
                  <span className="text-ink/60">{entry.actor?.name ?? "System"}</span>
                  <span className="text-xs text-ink/40">{entry.targetType}{entry.targetId ? ` · ${entry.targetId.slice(0, 10)}…` : ""}</span>
                  <span className="ml-auto text-xs text-ink/35">{timeAgo(entry.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<FileClock size={22} />} title="No audit events yet" description="Admin actions and account events will be recorded here." />}
        </section>
      )}
    </main>
  );
}
