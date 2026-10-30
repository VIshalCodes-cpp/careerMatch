import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BriefcaseBusiness, Filter, MapPin, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import JobCard from "@/components/JobCard";
import Pagination from "@/components/Pagination";
import EmptyState from "@/components/EmptyState";
import { api } from "@/lib/api";
import { employmentTypes } from "@/lib/format";
import type { Job, PaginationMeta } from "@/lib/types";

type JobsResponse = { data: Job[]; meta: PaginationMeta };

const SOURCE_OPTIONS = [
  { value: "all", label: "All sources" },
  { value: "recruiter", label: "Direct listings" },
  { value: "external", label: "Partner feeds" },
];

export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [locationInput, setLocationInput] = useState(params.get("location") ?? "");

  const query = params.toString();
  const page = Number(params.get("page") ?? 1);
  const sort = params.get("sort") ?? "newest";
  const employmentType = params.get("employmentType") ?? "";
  const remote = params.get("remote") ?? "";
  const source = params.get("source") ?? "all";
  const experience = params.get("experience") ?? "";

  const update = (key: string, value?: string | null) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  const clearAll = () => {
    setParams(new URLSearchParams(), { replace: true });
    setSearch("");
    setLocationInput("");
  };

  useEffect(() => {
    setSearch(params.get("q") ?? "");
    setLocationInput(params.get("location") ?? "");
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const request = new URLSearchParams(query);
    request.set("limit", "12");
    api<JobsResponse>(`/jobs?${request.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setJobs(result.data);
        setMeta(result.meta);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Could not load jobs.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [query]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (search.trim()) next.set("q", search.trim()); else next.delete("q");
    if (locationInput.trim()) next.set("location", locationInput.trim()); else next.delete("location");
    next.delete("page");
    setParams(next, { replace: true });
  };

  const activeFilters = useMemo(() => {
    const items: { key: string; label: string }[] = [];
    if (employmentType) items.push({ key: "employmentType", label: employmentType });
    if (remote === "true") items.push({ key: "remote", label: "Remote" });
    if (remote === "false") items.push({ key: "remote", label: "On-site" });
    if (experience) items.push({ key: "experience", label: `Up to ${experience} yrs` });
    if (source !== "all") items.push({ key: "source", label: SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source });
    if (params.get("q")) items.push({ key: "q", label: `“${params.get("q")}”` });
    if (params.get("location")) items.push({ key: "location", label: params.get("location")! });
    return items;
  }, [employmentType, remote, experience, source, params]);

  const typeCounts = new Map(meta?.facets?.employmentTypes?.map((facet) => [facet.value, facet.count]));
  const filterCount = activeFilters.length;

  const filters = (
    <div className="panel space-y-7">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={15} /> Filters</p>
        {filterCount > 0 && <button type="button" onClick={clearAll} className="text-xs text-coral hover:underline">Clear all</button>}
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-ink/40">Work mode</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[{ value: "", label: "Any" }, { value: "true", label: "Remote" }, { value: "false", label: "On-site" }].map((option) => (
            <button key={option.value} type="button" onClick={() => update("remote", option.value)} className={`chip ${remote === option.value ? "chip-active" : ""}`}>{option.label}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-ink/40">Employment type</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {employmentTypes().map((type) => {
            const count = typeCounts.get(type);
            return (
              <button key={type} type="button" onClick={() => update("employmentType", employmentType === type ? "" : type)} className={`chip ${employmentType === type ? "chip-active" : ""}`}>
                {type}{count ? <span className="opacity-60">· {count}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-ink/40">Experience</p>
        <select className="field mt-3" value={experience} onChange={(event) => update("experience", event.target.value)} aria-label="Experience filter">
          <option value="">Any experience</option>
          <option value="1">Up to 1 year</option>
          <option value="2">Up to 2 years</option>
          <option value="5">Up to 5 years</option>
          <option value="8">Up to 8 years</option>
          <option value="12">Up to 12 years</option>
        </select>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-ink/40">Listing source</p>
        <div className="mt-3 space-y-1.5">
          {SOURCE_OPTIONS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-ink/60">
              <input type="radio" name="source" checked={source === option.value} onChange={() => update("source", option.value === "all" ? "" : option.value)} className="accent-coral" />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-secondary/70 p-3 text-[11px] leading-5 text-ink/45">
        <Sparkles size={13} className="mb-1 text-coral" />
        Sign in as a candidate to see fit scores against your saved profile.
      </div>
    </div>
  );

  return (
    <main className="shell py-10 md:py-16">
      <div className="flex flex-col justify-between gap-6 border-b border-ink/10 pb-9 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <p className="eyebrow"><span className="size-1.5 rounded-full bg-coral" /> Opportunities</p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Find work that fits.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-ink/55">
            Real roles from direct recruiters and attributed public feeds. Compare requirements, salary, and location before you spend time applying.
          </p>
        </div>
        <div className="flex items-center gap-5 text-xs text-ink/45">
          <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-coral" /> {meta?.total ?? "—"} open roles</span>
          <span className="hidden items-center gap-2 sm:flex"><BriefcaseBusiness size={13} /> {meta?.facets?.sources?.length ?? 3} sources</span>
        </div>
      </div>

      <form onSubmit={submitSearch} className="mt-7 grid gap-3 md:grid-cols-[1fr_260px_auto] lg:grid-cols-[1fr_260px_auto]">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/35" size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="field pl-11" placeholder="Search roles, companies, or skills" aria-label="Search jobs" />
        </div>
        <div className="relative">
          <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/35" size={16} />
          <input value={locationInput} onChange={(event) => setLocationInput(event.target.value)} className="field pl-10" placeholder="City or Remote" aria-label="Location" />
        </div>
        <button className="button button-dark !h-11 !py-2.5" type="submit">Search</button>
      </form>

      {activeFilters.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[.12em] text-ink/35">Active</span>
          {activeFilters.map((item) => (
            <button key={item.key} type="button" onClick={() => update(item.key, "")} className="inline-flex items-center gap-1 rounded-full bg-coral/10 px-2.5 py-1 text-[11px] font-medium text-coral hover:bg-coral/15">
              {item.label} <X size={11} />
            </button>
          ))}
          <button type="button" onClick={clearAll} className="text-[11px] text-ink/40 underline underline-offset-2 hover:text-ink">Clear</button>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[252px_1fr]">
        <aside className={`${showFilters ? "block" : "hidden"} lg:block`}>
          <div className="lg:sticky lg:top-24">{filters}</div>
        </aside>

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setShowFilters((current) => !current)} className="chip lg:hidden">
                <Filter size={13} /> Filters {filterCount ? `(${filterCount})` : ""}
              </button>
              <p className="text-sm text-ink/50">
                {loading ? "Loading opportunities…" : <>{meta?.total ?? 0} roles{params.get("q") ? <> for <span className="font-medium text-ink">“{params.get("q")}”</span></> : null}</>}
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink/45">
              Sort
              <select value={sort} onChange={(event) => update("sort", event.target.value === "newest" ? "" : event.target.value)} className="rounded-lg border border-ink/12 bg-transparent px-2.5 py-1.5 text-xs text-ink/70 outline-none focus:border-coral">
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="salary">Highest salary</option>
                <option value="company">Company A–Z</option>
              </select>
            </label>
          </div>

          {error && <p role="alert" className="mb-4 rounded-xl border border-red-300/40 bg-red-50/60 p-4 text-sm text-red-700">{error}</p>}

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="animate-pulse rounded-2xl border border-ink/10 p-5">
                  <div className="flex gap-4">
                    <div className="size-11 rounded-xl bg-ink/10" />
                    <div className="flex-1 space-y-2.5">
                      <div className="h-4 w-2/5 rounded bg-ink/10" />
                      <div className="h-3 w-1/3 rounded bg-ink/[.07]" />
                      <div className="h-3 w-4/5 rounded bg-ink/[.06]" />
                      <div className="flex gap-2 pt-1">{[0, 1, 2].map((pill) => <div key={pill} className="h-5 w-16 rounded bg-ink/[.06]" />)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : jobs.length ? (
            <>
              <div className="space-y-3">
                {jobs.map((job) => <JobCard key={job.id} job={job} />)}
              </div>
              <Pagination page={meta?.page ?? page} pages={meta?.pages ?? 1} onChange={(next) => update("page", String(next))} />
            </>
          ) : (
            <EmptyState
              icon={<BriefcaseBusiness size={22} />}
              title="No roles match those filters"
              description="Try removing a filter, searching a broader title, or checking remote roles. New listings are imported regularly."
              actionLabel="Clear filters"
              onAction={clearAll}
            />
          )}

          <div className="mt-10 flex items-start gap-3 border-t border-ink/10 pt-6 text-xs leading-5 text-ink/40">
            <BriefcaseBusiness size={15} className="mt-0.5 shrink-0 text-coral" />
            <p>
              Fit scores are relative profile comparisons, not a probability of being hired. Partner listings link to the original posting and are attributed to
              <a className="mx-1 underline underline-offset-2 hover:text-ink" href="https://www.adzuna.in" target="_blank" rel="noreferrer">Adzuna</a>,
              <a className="mx-1 underline underline-offset-2 hover:text-ink" href="https://in.jooble.org" target="_blank" rel="noreferrer">Jooble</a>,
              <a className="mx-1 underline underline-offset-2 hover:text-ink" href="https://remotive.com" target="_blank" rel="noreferrer">Remotive</a>,
              <a className="mx-1 underline underline-offset-2 hover:text-ink" href="https://www.arbeitnow.com" target="_blank" rel="noreferrer">Arbeitnow</a>,
              <a className="mx-1 underline underline-offset-2 hover:text-ink" href="https://jobicy.com" target="_blank" rel="noreferrer">Jobicy</a> and
              <a className="ml-1 underline underline-offset-2 hover:text-ink" href="https://remoteok.com" target="_blank" rel="noreferrer">RemoteOK</a>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
