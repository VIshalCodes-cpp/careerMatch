import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Building2, CalendarDays, ExternalLink, MapPin, Users } from "lucide-react";
import CompanyLogo from "@/components/CompanyLogo";
import JobCard from "@/components/JobCard";
import EmptyState from "@/components/EmptyState";
import { api, Envelope } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Job } from "@/lib/types";

type CompanyDetail = {
  id: string;
  name: string;
  logoUrl?: string | null;
  website?: string | null;
  location?: string | null;
  description?: string | null;
  createdAt?: string;
  openRoles?: number;
  _count?: { jobs: number; recruiters: number };
  jobs: Job[];
};

export default function CompanyPage() {
  const { companyId } = useParams();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    api<Envelope<CompanyDetail>>(`/companies/${companyId}`)
      .then((result) => setCompany(result.data))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load this company."))
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <main className="shell py-16 text-sm text-ink/50">Loading company…</main>;
  if (!company) return (
    <main className="shell py-20">
      <p role="alert" className="text-sm text-red-700">{error || "This company is not available."}</p>
      <Link to="/companies" className="back-link mt-6"><ArrowLeft size={15} /> Back to companies</Link>
    </main>
  );

  return (
    <main className="shell py-10 md:py-14">
      <Link to="/companies" className="back-link"><ArrowLeft size={15} /> Back to companies</Link>

      <div className="mt-8 flex flex-col gap-6 border-b border-ink/10 pb-9 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-5">
          <CompanyLogo name={company.name} logoUrl={company.logoUrl} size="xl" />
          <div>
            <p className="eyebrow"><Building2 size={12} /> Company profile</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">{company.name}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink/50">
              {company.location && <span className="flex items-center gap-1.5"><MapPin size={14} /> {company.location}</span>}
              <span className="flex items-center gap-1.5"><Users size={14} /> {company._count?.recruiters ?? 0} recruiter{(company._count?.recruiters ?? 0) === 1 ? "" : "s"}</span>
              {company.createdAt && <span className="flex items-center gap-1.5"><CalendarDays size={14} /> Joined {formatDate(company.createdAt)}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {company.website && <a href={company.website} target="_blank" rel="noreferrer" className="button button-outline"><ExternalLink size={15} /> Website</a>}
          <Link to={`/jobs?q=${encodeURIComponent(company.name)}`} className="button button-dark">View roles <span className="rounded bg-white/15 px-1.5 text-xs">{company.openRoles ?? company.jobs.length}</span></Link>
        </div>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="section-title">Open roles</h2>
          {company.jobs.length ? (
            <div className="mt-5 space-y-3">{company.jobs.map((job) => <JobCard key={job.id} job={job} />)}</div>
          ) : (
            <div className="mt-5">
              <EmptyState icon={<Building2 size={22} />} title="No open roles right now" description="Follow this company by checking back, or browse other opportunities." actionLabel="Browse all jobs" actionTo="/jobs" />
            </div>
          )}
        </section>

        <aside>
          <div className="panel">
            <p className="eyebrow">About</p>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-ink/60">{company.description || "This company has not added a description yet."}</p>
          </div>
          <div className="panel mt-4">
            <p className="eyebrow">Hiring snapshot</p>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between"><dt className="text-ink/45">Open roles</dt><dd className="font-semibold">{company.openRoles ?? company.jobs.length}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-ink/45">Total listings</dt><dd className="font-semibold">{company._count?.jobs ?? company.jobs.length}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-ink/45">Recruiters</dt><dd className="font-semibold">{company._count?.recruiters ?? 0}</dd></div>
            </dl>
          </div>
        </aside>
      </div>
    </main>
  );
}
