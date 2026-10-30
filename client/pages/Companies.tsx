import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, MapPin, Search } from "lucide-react";
import CompanyLogo from "@/components/CompanyLogo";
import EmptyState from "@/components/EmptyState";
import { api } from "@/lib/api";

type CompanyRow = { id: string; name: string; logoUrl?: string | null; location?: string | null; website?: string | null; description?: string | null; _count?: { jobs: number } };
type CompaniesResponse = { data: CompanyRow[]; meta: { page: number; pages: number; total: number } };

export default function Companies() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [meta, setMeta] = useState<CompaniesResponse["meta"] | null>(null);
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = (search = "") => {
    setLoading(true);
    api<CompaniesResponse>(`/companies?limit=36${search ? `&q=${encodeURIComponent(search)}` : ""}`)
      .then((result) => { setCompanies(result.data); setMeta(result.meta); setError(""); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load companies."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { void load(); }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(input.trim());
    load(input.trim());
  };

  return (
    <main className="shell py-10 md:py-16">
      <div className="flex flex-col justify-between gap-6 border-b border-ink/10 pb-9 md:flex-row md:items-end">
        <div className="max-w-2xl">
          <p className="eyebrow"><Building2 size={12} /> Companies</p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Teams with open doors.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-ink/55">Every company here has at least one live role. Open a profile to see the full list before you apply.</p>
        </div>
        <p className="text-xs text-ink/45">{meta?.total ?? "—"} companies hiring</p>
      </div>

      <form onSubmit={submit} className="mt-7 flex max-w-md gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/35" size={16} />
          <input value={input} onChange={(event) => setInput(event.target.value)} className="field pl-10" placeholder="Search companies" aria-label="Search companies" />
        </div>
        <button type="submit" className="button button-dark !py-2.5">Search</button>
      </form>

      {error && <p role="alert" className="mt-6 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="h-40 animate-pulse rounded-2xl border border-ink/10 bg-ink/[.03]" />)}
        </div>
      ) : companies.length ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((company) => (
            <Link key={company.id} to={`/companies/${company.id}`} className="group flex flex-col rounded-2xl border border-ink/10 bg-card p-5 transition-all hover:border-ink/25 hover:shadow-[0_12px_30px_rgba(25,30,26,.05)]">
              <div className="flex items-start justify-between">
                <CompanyLogo name={company.name} logoUrl={company.logoUrl} />
                <span className="rounded-md bg-[#dff1e8] px-2 py-1 text-[10px] font-semibold text-[#27634e]">{company._count?.jobs ?? 0} open</span>
              </div>
              <h2 className="mt-4 font-display text-lg font-semibold tracking-[-.025em] transition-colors group-hover:text-coral">{company.name}</h2>
              {company.location && <p className="mt-1 flex items-center gap-1 text-xs text-ink/45"><MapPin size={11} /> {company.location}</p>}
              {company.description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink/45">{company.description}</p>}
              <span className="mt-auto flex items-center justify-between pt-4 text-xs font-medium text-ink/50 group-hover:text-ink">
                View roles <ArrowRight size={13} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-8">
          <EmptyState icon={<Building2 size={22} />} title={query ? `No companies match “${query}”` : "No companies hiring yet"} description="Try a shorter search, or browse all open roles instead." actionLabel="Browse jobs" actionTo="/jobs" />
        </div>
      )}
    </main>
  );
}
