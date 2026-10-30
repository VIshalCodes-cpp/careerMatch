import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Bookmark, Search } from "lucide-react";
import JobCard from "@/components/JobCard";
import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { api, Envelope } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function SavedJobs() {
  const { user, loading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!user?.roles.includes("CANDIDATE")) return;
    api<Envelope<Job[]>>("/me/saved-jobs")
      .then((result) => setJobs(result.data))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load saved jobs."))
      .finally(() => setFetching(false));
  }, [user?.id]);

  if (loading) return <main className="shell py-16 text-sm text-ink/50">Loading saved jobs…</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.roles.includes("CANDIDATE")) return <Navigate to="/recruiter" replace />;

  const filtered = jobs.filter((job) => {
    if (!query.trim()) return true;
    const haystack = `${job.title} ${job.company?.name} ${job.location} ${job.skills.map((skill) => skill.name).join(" ")}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <main className="shell py-10 md:py-16">
      <div className="flex flex-col justify-between gap-5 border-b border-ink/10 pb-8 md:flex-row md:items-end">
        <div>
          <p className="eyebrow"><Bookmark size={12} /> Saved jobs</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Roles worth a second look.</h1>
          <p className="mt-3 text-sm text-ink/55">{jobs.length} saved {jobs.length === 1 ? "role" : "roles"}. Remove one whenever you are done with it.</p>
        </div>
        <Link to="/jobs" className="button button-dark">Find more roles</Link>
      </div>

      {jobs.length > 3 && (
        <div className="relative mt-6 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/35" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="field pl-10" placeholder="Filter saved roles" aria-label="Filter saved jobs" />
        </div>
      )}

      {error && <p role="alert" className="mt-6 text-sm text-red-700">{error}</p>}

      {fetching ? (
        <div className="mt-8 space-y-3">{[0, 1, 2].map((index) => <div key={index} className="h-32 animate-pulse rounded-2xl border border-ink/10 bg-ink/[.03]" />)}</div>
      ) : filtered.length ? (
        <div className="mt-8 space-y-3">
          {filtered.map((job) => (
            <JobCard key={job.id} job={{ ...job, saved: true }} onSavedChange={(jobId, saved) => !saved && setJobs((current) => current.filter((entry) => entry.id !== jobId))} />
          ))}
        </div>
      ) : jobs.length ? (
        <div className="mt-8">
          <EmptyState icon={<Search size={22} />} title="No saved roles match that filter" description="Try a different company, title, or skill." actionLabel="Clear filter" onAction={() => setQuery("")} />
        </div>
      ) : (
        <div className="mt-8">
          <EmptyState
            icon={<Bookmark size={22} />}
            title="Nothing saved yet"
            description="Press the bookmark on any listing to keep it here. Saved roles stay in your account and are separate from applications."
            actionLabel="Browse opportunities"
            actionTo="/jobs"
          />
        </div>
      )}
    </main>
  );
}
