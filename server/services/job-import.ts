import { randomUUID } from "node:crypto";
import { prisma } from "../lib/database";
import { extractSkills, isKnownSkill, normalizeSkillName } from "../lib/skills";
import { htmlToText, tidyText } from "../lib/text";

export type JobSourceName = "Remotive" | "Arbeitnow" | "Jobicy" | "RemoteOK" | "Adzuna" | "Jooble";

type NormalizedJob = {
  sourceName: JobSourceName;
  sourceJobId: string;
  title: string;
  companyName: string;
  companyLogo: string | null;
  location: string;
  employmentType: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  description: string;
  applyUrl: string;
  publishedAt: Date;
  skills: { name: string; required: boolean }[];
};

export type SyncResult = {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  companies: number;
  skills: number;
  providers: Record<string, number>;
  durationMs: number;
};

const REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent": "CareerMatch/1.0 (job discovery demo; contact: support@careermatch.local)",
};

type CountryConfig = { currency: string; name: string };

/**
 * Adzuna country codes, with the currency its salary figures are reported in.
 * `JOB_IMPORT_COUNTRY` picks one; India is the default because that is the
 * primary market for this board.
 */
const ADZUNA_COUNTRIES: Record<string, CountryConfig> = {
  at: { currency: "EUR", name: "Austria" },
  au: { currency: "AUD", name: "Australia" },
  be: { currency: "EUR", name: "Belgium" },
  br: { currency: "BRL", name: "Brazil" },
  ca: { currency: "CAD", name: "Canada" },
  ch: { currency: "CHF", name: "Switzerland" },
  de: { currency: "EUR", name: "Germany" },
  es: { currency: "EUR", name: "Spain" },
  fr: { currency: "EUR", name: "France" },
  gb: { currency: "GBP", name: "United Kingdom" },
  in: { currency: "INR", name: "India" },
  it: { currency: "EUR", name: "Italy" },
  jp: { currency: "JPY", name: "Japan" },
  mx: { currency: "MXN", name: "Mexico" },
  nl: { currency: "EUR", name: "Netherlands" },
  nz: { currency: "NZD", name: "New Zealand" },
  pl: { currency: "PLN", name: "Poland" },
  sg: { currency: "SGD", name: "Singapore" },
  us: { currency: "USD", name: "United States" },
  za: { currency: "ZAR", name: "South Africa" },
};

function stringEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function importCountry(): CountryConfig & { code: string } {
  const requested = (stringEnv("JOB_IMPORT_COUNTRY") ?? "in").toLowerCase();
  const code = ADZUNA_COUNTRIES[requested] ? requested : "in";
  return { code, ...ADZUNA_COUNTRIES[code] };
}

function disabledProviders(): Set<string> {
  return new Set(
    (stringEnv("JOB_IMPORT_DISABLED") ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function fetchJson(url: string, timeoutMs = 25_000): Promise<any> {
  const response = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  return response.json();
}

function asDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    // Feeds such as Jooble send UTC timestamps without an offset, sometimes with
    // microseconds ("2026-10-23T06:30:00.000000"). Without this, Node would read
    // them in the server's local zone and shift Indian listings by +05:30.
    const withoutZone = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
    const normalized = withoutZone.test(value) ? `${value.replace(" ", "T")}Z` : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function normalizeEmploymentType(value: unknown): string | null {
  const raw = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  const text = raw.toLowerCase();
  if (!text.trim()) return null;
  if (/intern/.test(text)) return "Internship";
  if (/part[\s-]?time/.test(text)) return "Part-time";
  if (/freelance/.test(text)) return "Freelance";
  if (/contract|temporary|temp\b/.test(text)) return "Contract";
  if (/full[\s-]?time|permanent/.test(text)) return "Full-time";
  return raw.slice(0, 60);
}

function normalizeLocation(value: unknown): string {
  const text = Array.isArray(value) ? value.filter(Boolean).join(", ") : String(value ?? "").trim();
  if (!text) return "Remote";
  const cleaned = tidyText(text).replace(/\s+/g, " ");
  if (/^(anywhere|worldwide|global)$/i.test(cleaned)) return "Remote · Worldwide";
  if (/remote/i.test(cleaned)) return cleaned.slice(0, 190);
  return cleaned.slice(0, 190);
}

const CURRENCY_BY_SYMBOL: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY", "₽": "RUB" };

function parseSalaryText(raw: string | null | undefined): { min: number | null; max: number | null; currency: string | null } {
  if (!raw) return { min: null, max: null, currency: null };
  const text = String(raw);
  const currency = Object.entries(CURRENCY_BY_SYMBOL).find(([symbol]) => text.includes(symbol))?.[1] ?? (/usd/i.test(text) ? "USD" : /eur/i.test(text) ? "EUR" : /inr|rupee/i.test(text) ? "INR" : null);
  const values = [...text.matchAll(/(\d[\d,.]*)\s*(k|m)?/gi)]
    .map((match) => {
      const numeric = Number(match[1].replace(/,/g, ""));
      if (!Number.isFinite(numeric) || numeric <= 0) return null;
      const suffix = match[2]?.toLowerCase();
      const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
      return Math.round(numeric * multiplier);
    })
    .filter((value): value is number => value !== null && value >= 1_000 && value <= 100_000_000);
  if (!values.length) return { min: null, max: null, currency };
  const unique = [...new Set(values)].sort((a, b) => a - b);
  return { min: unique[0] ?? null, max: unique.length > 1 ? unique[unique.length - 1] : null, currency };
}

function parseSalaryRange(min: unknown, max: unknown, currency: unknown): { min: number | null; max: number | null; currency: string | null } {
  const parse = (value: unknown) => {
    if (value == null || value === "") return null;
    const numeric = Number(String(value).replace(/[^\d.]/g, ""));
    return Number.isFinite(numeric) && numeric >= 1_000 && numeric <= 100_000_000 ? Math.round(numeric) : null;
  };
  const lower = parse(min);
  const upper = parse(max);
  if (lower == null && upper == null) return { min: null, max: null, currency: null };
  return { min: lower, max: upper, currency: currency ? String(currency).toUpperCase().slice(0, 3) : null };
}

function inferExperience(description: string, level?: unknown): { min: number | null; max: number | null } {
  const levelText = String(level ?? "").toLowerCase();
  if (/intern|entry|junior|graduate/.test(levelText)) return { min: 0, max: 2 };
  if (/mid/.test(levelText)) return { min: 2, max: 5 };
  if (/senior/.test(levelText)) return { min: 5, max: 9 };
  if (/lead|principal|staff/.test(levelText)) return { min: 8, max: 14 };
  if (/executive|director|head/.test(levelText)) return { min: 10, max: null };
  const match = description.match(/(?:minimum(?: of)?|at least)\s+(\d{1,2})\s*\+?\s*years?/i) ?? description.match(/\b(\d{1,2})\s*\+\s*years?(?: of)?(?: (?:relevant|professional|industry))? experience/i);
  if (match) {
    const years = Number(match[1]);
    return { min: years, max: years + 6 };
  }
  return { min: null, max: null };
}

function buildSkills(title: string, description: string, tags: unknown): { name: string; required: boolean }[] {
  const tagNames = (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag ?? "").trim())
    .filter(Boolean)
    .map((tag) => (isKnownSkill(tag) ? normalizeSkillName(tag) : tag))
    .filter((tag) => tag.length <= 60 && /^[A-Za-z0-9+#.\s/-]+$/.test(tag));
  const required = [...new Set([...extractSkills(title, 6), ...tagNames.filter(isKnownSkill).slice(0, 6)])].slice(0, 8);
  const preferred = extractSkills(`${title}\n${description}`, 24).filter((skill) => !required.includes(skill)).slice(0, 10);
  const skills = [...required.map((name) => ({ name, required: true })), ...preferred.map((name) => ({ name, required: false }))];
  if (!skills.some((skill) => skill.required) && skills.length) {
    skills[0].required = true;
    if (skills[1]) skills[1].required = true;
  }
  return skills.slice(0, 12);
}

async function fetchRemotive(): Promise<NormalizedJob[]> {
  const payload = await fetchJson("https://remotive.com/api/remote-jobs?limit=200");
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.flatMap((job: any) => {
    const description = htmlToText(String(job.description ?? "")).slice(0, 12_000);
    const publishedAt = asDate(job.publication_date) ?? new Date();
    if (!job.id || !job.title || !job.company_name || description.length < 40) return [];
    const salary = parseSalaryText(job.salary);
    const experience = inferExperience(description);
    return [{
      sourceName: "Remotive" as const,
      sourceJobId: `remotive:${job.id}`,
      title: String(job.title).slice(0, 200),
      companyName: String(job.company_name).slice(0, 180),
      companyLogo: /^https:\/\//.test(String(job.company_logo ?? "")) ? String(job.company_logo) : null,
      location: normalizeLocation(job.candidate_required_location),
      employmentType: normalizeEmploymentType(job.job_type),
      experienceMin: experience.min,
      experienceMax: experience.max,
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryCurrency: salary.currency,
      description,
      applyUrl: String(job.url ?? "").slice(0, 1000),
      publishedAt,
      skills: buildSkills(String(job.title), description, job.tags),
    }];
  });
}

async function fetchArbeitnow(): Promise<NormalizedJob[]> {
  const pages = await Promise.allSettled([fetchJson("https://www.arbeitnow.com/api/job-board-api"), fetchJson("https://www.arbeitnow.com/api/job-board-api?page=2")]);
  const jobs = pages.flatMap((page) => (page.status === "fulfilled" && Array.isArray(page.value?.data) ? page.value.data : []));
  return jobs.flatMap((job: any) => {
    const description = htmlToText(String(job.description ?? "")).slice(0, 12_000);
    if (!job.slug || !job.title || !job.company_name || description.length < 40) return [];
    const location = job.remote ? normalizeLocation(job.location ? `Remote · ${job.location}` : "Remote") : normalizeLocation(job.location);
    const experience = inferExperience(description);
    return [{
      sourceName: "Arbeitnow" as const,
      sourceJobId: `arbeitnow:${job.slug}`,
      title: String(job.title).slice(0, 200),
      companyName: String(job.company_name).slice(0, 180),
      companyLogo: null,
      location,
      employmentType: normalizeEmploymentType(job.job_types),
      experienceMin: experience.min,
      experienceMax: experience.max,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      description,
      applyUrl: String(job.url ?? "").slice(0, 1000),
      publishedAt: asDate(job.created_at) ?? new Date(),
      skills: buildSkills(String(job.title), description, job.tags),
    }];
  });
}

async function fetchJobicy(): Promise<NormalizedJob[]> {
  const payload = await fetchJson("https://jobicy.com/api/v2/remote-jobs?count=100");
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.flatMap((job: any) => {
    const description = htmlToText(String(job.jobDescription ?? "")).slice(0, 12_000);
    if (!job.id || !job.jobTitle || !job.companyName || description.length < 40) return [];
    const salary = parseSalaryRange(job.annualSalaryMin, job.annualSalaryMax, job.salaryCurrency);
    const experience = inferExperience(description, job.jobLevel);
    return [{
      sourceName: "Jobicy" as const,
      sourceJobId: `jobicy:${job.id}`,
      title: String(job.jobTitle).slice(0, 200),
      companyName: String(job.companyName).slice(0, 180),
      companyLogo: /^https:\/\//.test(String(job.companyLogo ?? "")) ? String(job.companyLogo) : null,
      location: normalizeLocation(job.jobGeo),
      employmentType: normalizeEmploymentType(job.jobType),
      experienceMin: experience.min,
      experienceMax: experience.max,
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryCurrency: salary.currency,
      description,
      applyUrl: String(job.url ?? "").slice(0, 1000),
      publishedAt: asDate(job.pubDate) ?? new Date(),
      skills: buildSkills(String(job.jobTitle), description, job.jobIndustry),
    }];
  });
}

async function fetchRemoteOk(): Promise<NormalizedJob[]> {
  const payload = await fetchJson("https://remoteok.com/api");
  const jobs = Array.isArray(payload) ? payload.filter((job: any) => job && job.id && job.position && job.company) : [];
  return jobs.flatMap((job: any) => {
    const description = htmlToText(String(job.description ?? "")).slice(0, 12_000);
    if (description.length < 40) return [];
    const tags = Array.isArray(job.tags) ? job.tags : [];
    const typeTag = tags.find((tag: string) => /full.?time|part.?time|contract|intern|freelance/i.test(tag));
    const salary = parseSalaryRange(job.salary_min, job.salary_max, "USD");
    const experience = inferExperience(description);
    return [{
      sourceName: "RemoteOK" as const,
      sourceJobId: `remoteok:${job.id}`,
      title: String(job.position).slice(0, 200),
      companyName: String(job.company).slice(0, 180),
      companyLogo: /^https:\/\//.test(String(job.company_logo ?? job.logo ?? "")) ? String(job.company_logo ?? job.logo) : null,
      location: normalizeLocation(job.location || "Remote"),
      employmentType: typeTag ? normalizeEmploymentType(typeTag) : null,
      experienceMin: experience.min,
      experienceMax: experience.max,
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryCurrency: salary.currency,
      description,
      applyUrl: String(job.apply_url || job.url || "").slice(0, 1000),
      publishedAt: asDate(job.date) ?? new Date(),
      skills: buildSkills(String(job.position), description, tags),
    }];
  });
}

/**
 * Normalizes one Adzuna result. Adzuna reports salary as plain numbers in the
 * country's currency and marks modelled figures with `salary_is_predicted`, so
 * predicted pay is dropped rather than shown as fact.
 */
export function normalizeAdzunaJob(job: any, country: CountryConfig & { code: string }): NormalizedJob | null {
  if (!job?.id || !job.title || !job.redirect_url) return null;
  const description = htmlToText(String(job.description ?? "")).slice(0, 12_000);
  if (description.length < 40) return null;
  const companyName = String(job.company?.display_name ?? "").trim();
  if (companyName.length < 2) return null;
  const rawLocation = String(job.location?.display_name ?? job.location?.area?.slice(-1).join(", ") ?? "").trim();
  const salary = String(job.salary_is_predicted ?? "0") === "1"
    ? { min: null, max: null, currency: null }
    : parseSalaryRange(job.salary_min, job.salary_max, country.currency);
  const experience = inferExperience(description);
  return {
    sourceName: "Adzuna",
    sourceJobId: `adzuna:${country.code}:${job.id}`,
    title: String(job.title).slice(0, 200),
    companyName: companyName.slice(0, 180),
    companyLogo: null,
    location: normalizeLocation(rawLocation || country.name),
    employmentType: normalizeEmploymentType(`${job.contract_time ?? ""} ${job.contract_type ?? ""}`),
    experienceMin: experience.min,
    experienceMax: experience.max,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    description,
    applyUrl: String(job.redirect_url).slice(0, 1000),
    publishedAt: asDate(job.created) ?? new Date(),
    skills: buildSkills(String(job.title), description, job.category?.label),
  };
}

/** Normalizes one Jooble result. Jooble quotes salary as free text and only ships a snippet on some feeds. */
export function normalizeJoobleJob(job: any): NormalizedJob | null {
  if (!job?.id || !job.title || !job.link) return null;
  const description = htmlToText(String(job.description ?? job.snippet ?? "")).slice(0, 12_000);
  if (description.length < 40) return null;
  const companyName = String(job.company ?? "").trim();
  if (companyName.length < 2) return null;
  const salary = parseSalaryText(String(job.salary ?? ""));
  const experience = inferExperience(description);
  return {
    sourceName: "Jooble",
    sourceJobId: `jooble:${job.id}`,
    title: String(job.title).slice(0, 200),
    companyName: companyName.slice(0, 180),
    companyLogo: null,
    location: normalizeLocation(job.location || importCountry().name),
    employmentType: normalizeEmploymentType(job.type),
    experienceMin: experience.min,
    experienceMax: experience.max,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    description,
    applyUrl: String(job.link).slice(0, 1000),
    publishedAt: asDate(job.updated) ?? new Date(),
    skills: buildSkills(String(job.title), description, null),
  };
}

async function fetchAdzuna(): Promise<NormalizedJob[]> {
  const appId = stringEnv("ADZUNA_APP_ID");
  const appKey = stringEnv("ADZUNA_APP_KEY");
  if (!appId || !appKey) throw new Error("Adzuna is not configured (set ADZUNA_APP_ID and ADZUNA_APP_KEY).");
  const country = importCountry();
  const requestedPages = Number(process.env.ADZUNA_PAGES ?? 2);
  const pages = Number.isFinite(requestedPages) ? Math.min(Math.max(Math.trunc(requestedPages), 1), 5) : 2;
  const what = stringEnv("JOB_IMPORT_QUERY");
  const where = stringEnv("JOB_IMPORT_LOCATION");
  const collected: NormalizedJob[] = [];

  for (let page = 1; page <= pages; page += 1) {
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country.code}/search/${page}`);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("results_per_page", "50");
    url.searchParams.set("content-type", "application/json");
    url.searchParams.set("sort_by", "date");
    if (what) url.searchParams.set("what", what);
    if (where) url.searchParams.set("where", where);
    const payload = await fetchJson(url.toString());
    const results = Array.isArray(payload?.results) ? payload.results : [];
    if (!results.length) break;
    for (const result of results) {
      const job = normalizeAdzunaJob(result, country);
      if (job) collected.push(job);
    }
  }
  return collected;
}

async function fetchJooble(): Promise<NormalizedJob[]> {
  const apiKey = stringEnv("JOOBLE_API_KEY");
  if (!apiKey) throw new Error("Jooble is not configured (set JOOBLE_API_KEY).");
  const response = await fetch(`https://jooble.org/api/${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { ...REQUEST_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      keywords: stringEnv("JOB_IMPORT_QUERY") ?? "",
      location: stringEnv("JOB_IMPORT_LOCATION") ?? importCountry().name,
      page: "1",
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`jooble.org returned ${response.status}`);
  const payload = await response.json();
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.flatMap((job: any) => normalizeJoobleJob(job) ?? []);
}

type ProviderDefinition = {
  name: JobSourceName;
  requires: string;
  configured: () => boolean;
  load: () => Promise<NormalizedJob[]>;
};

const PROVIDERS: ProviderDefinition[] = [
  { name: "Adzuna", requires: "ADZUNA_APP_ID and ADZUNA_APP_KEY", configured: () => Boolean(stringEnv("ADZUNA_APP_ID") && stringEnv("ADZUNA_APP_KEY")), load: fetchAdzuna },
  { name: "Jooble", requires: "JOOBLE_API_KEY", configured: () => Boolean(stringEnv("JOOBLE_API_KEY")), load: fetchJooble },
  { name: "Remotive", requires: "No key", configured: () => true, load: fetchRemotive },
  { name: "Jobicy", requires: "No key", configured: () => true, load: fetchJobicy },
  { name: "RemoteOK", requires: "No key", configured: () => true, load: fetchRemoteOk },
  { name: "Arbeitnow", requires: "No key", configured: () => true, load: fetchArbeitnow },
];

export type JobProviderStatus = { name: JobSourceName; enabled: boolean; configured: boolean; requires: string };

/** Which feeds will actually run, so the UI and logs can explain missing sources instead of guessing. */
export function jobProviderStatus(): JobProviderStatus[] {
  const disabled = disabledProviders();
  return PROVIDERS.map((provider) => {
    const configured = provider.configured();
    return {
      name: provider.name,
      requires: provider.requires,
      configured,
      enabled: configured && !disabled.has(provider.name.toLowerCase()),
    };
  });
}

function dedupe(jobs: NormalizedJob[]) {
  const seen = new Map<string, NormalizedJob>();
  for (const job of jobs) {
    const key = `${job.companyName.toLowerCase().trim()}|${job.title.toLowerCase().trim()}|${job.location.toLowerCase().trim()}`;
    if (!seen.has(key)) seen.set(key, job);
  }
  return [...seen.values()];
}

async function ensureImportUser() {
  const email = (process.env.JOB_IMPORT_EMAIL ?? "jobs@careermatch.local").toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const recruiter = await prisma.recruiterProfile.findUnique({ where: { userId: existing.id } });
    if (!recruiter) await prisma.recruiterProfile.create({ data: { userId: existing.id } });
    return existing;
  }
  return prisma.user.create({
    data: {
      email,
      name: "CareerMatch Jobs",
      emailVerifiedAt: new Date(),
      roles: { create: { role: "RECRUITER" } },
      recruiter: { create: {} },
    },
  });
}

async function upsertCompanies(jobs: NormalizedJob[]) {
  const companies = await prisma.company.findMany({ select: { id: true, name: true, logoUrl: true } });
  const byName = new Map(companies.map((company) => [company.name.toLowerCase().trim(), company]));
  const toCreate: { id: string; name: string; location: string; logoUrl: string | null }[] = [];
  const logoUpdates: { id: string; logoUrl: string }[] = [];

  for (const job of jobs) {
    const key = job.companyName.toLowerCase().trim();
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing) {
      const created = { id: randomUUID(), name: job.companyName.trim(), location: job.location, logoUrl: job.companyLogo };
      toCreate.push(created);
      byName.set(key, { id: created.id, name: created.name, logoUrl: created.logoUrl });
    } else if (job.companyLogo && !existing.logoUrl) {
      existing.logoUrl = job.companyLogo;
      logoUpdates.push({ id: existing.id, logoUrl: job.companyLogo });
    }
  }

  if (toCreate.length) {
    const chunkSize = 200;
    for (let index = 0; index < toCreate.length; index += chunkSize) {
      await prisma.company.createMany({ data: toCreate.slice(index, index + chunkSize), skipDuplicates: true });
    }
  }
  if (logoUpdates.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Company" AS c SET "logoUrl" = x."logoUrl", "updatedAt" = NOW()
       FROM jsonb_to_recordset($1::jsonb) AS x("id" text, "logoUrl" text)
       WHERE c."id" = x."id"`,
      JSON.stringify(logoUpdates),
    ).catch(() => undefined);
  }
  return byName;
}

async function upsertSkills(jobs: NormalizedJob[]) {
  const all = await prisma.skill.findMany({ select: { id: true, name: true, normalizedName: true } });
  const byNormalized = new Map(all.map((skill) => [skill.normalizedName, skill]));
  const toCreate: { id: string; name: string; normalizedName: string }[] = [];
  for (const job of jobs) {
    for (const skill of job.skills) {
      const normalizedName = skill.name.toLowerCase();
      if (byNormalized.has(normalizedName) || toCreate.some((entry) => entry.normalizedName === normalizedName)) continue;
      const created = { id: randomUUID(), name: skill.name, normalizedName };
      toCreate.push(created);
      byNormalized.set(normalizedName, created);
    }
  }
  if (toCreate.length) await prisma.skill.createMany({ data: toCreate, skipDuplicates: true });
  return byNormalized;
}

let syncInFlight: Promise<SyncResult> | null = null;

/**
 * Imports real, publicly available jobs from documented public APIs. Uses only
 * documented public endpoints, attributes every listing to its source, and
 * links back to the original posting.
 */
export async function syncExternalJobs(options: { force?: boolean } = {}): Promise<SyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const startedAt = Date.now();
    const importUser = await ensureImportUser();

    const providers: Record<string, number> = {};
    const enabled = new Set(jobProviderStatus().filter((provider) => provider.enabled).map((provider) => provider.name));
    const activeProviders = PROVIDERS.filter((provider) => enabled.has(provider.name));
    if (!activeProviders.length) {
      throw new Error("No job providers are enabled; check JOB_IMPORT_DISABLED and the provider API keys.");
    }
    const settled = await Promise.allSettled(activeProviders.map((provider) => provider.load()));
    const collected = settled.flatMap((result, index) => {
      if (result.status === "rejected") {
        console.warn(`[jobs] provider ${activeProviders[index].name} failed: ${result.reason?.message ?? result.reason}`);
        return [];
      }
      return result.value;
    });
    for (const job of collected) providers[job.sourceName] = (providers[job.sourceName] ?? 0) + 1;

    const jobs = dedupe(collected).filter((job) => job.applyUrl.startsWith("http") && job.companyName.trim().replace(/[^\p{L}\p{N}]/gu, "").length >= 2);
    if (!jobs.length) {
      throw new Error("All external job providers failed; nothing was imported.");
    }

    const companies = await upsertCompanies(jobs);
    const skills = await upsertSkills(jobs);
    const existingJobs = await prisma.job.findMany({ where: { source: "EXTERNAL" }, select: { id: true, sourceJobId: true, status: true } });
    const existingBySource = new Map(existingJobs.map((job) => [job.sourceJobId!, job]));

    const toCreate: any[] = [];
    const toUpdate: { job: NormalizedJob; id: string }[] = [];
    const jobSkillRows: any[] = [];
    const updatedIds: string[] = [];

    const skillRowsFor = (jobId: string, job: NormalizedJob) => {
      const seen = new Set<string>();
      for (const skill of job.skills) {
        const record = skills.get(skill.name.toLowerCase());
        if (!record || seen.has(record.id)) continue;
        seen.add(record.id);
        jobSkillRows.push({ jobId, skillId: record.id, required: skill.required });
      }
    };

    for (const job of jobs) {
      const company = companies.get(job.companyName.toLowerCase().trim());
      if (!company) continue;
      const existing = existingBySource.get(job.sourceJobId);
      if (existing) {
        toUpdate.push({ job, id: existing.id });
        updatedIds.push(existing.id);
        skillRowsFor(existing.id, job);
      } else {
        const id = randomUUID();
        toCreate.push({
          id,
          source: "EXTERNAL",
          sourceName: job.sourceName,
          sourceJobId: job.sourceJobId,
          title: job.title,
          description: job.description,
          searchText: job.description.slice(0, 3000),
          location: job.location,
          employmentType: job.employmentType,
          experienceMin: job.experienceMin,
          experienceMax: job.experienceMax,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryCurrency: job.salaryCurrency ?? undefined,
          status: "PUBLISHED",
          publishedAt: job.publishedAt,
          expiresAt: new Date(job.publishedAt.getTime() + 60 * 24 * 60 * 60 * 1000),
          applyUrl: job.applyUrl,
          companyId: company.id,
          createdById: importUser.id,
        });
        skillRowsFor(id, job);
      }
    }

    if (toCreate.length) {
      const chunkSize = 80;
      for (let index = 0; index < toCreate.length; index += chunkSize) {
        await prisma.job.createMany({ data: toCreate.slice(index, index + chunkSize), skipDuplicates: true });
      }
    }

    if (toUpdate.length) {
      const rows = toUpdate.map(({ job, id }) => {
        const company = companies.get(job.companyName.toLowerCase().trim())!;
        return {
          id,
          title: job.title,
          description: job.description,
          searchText: job.description.slice(0, 3000),
          location: job.location,
          employmentType: job.employmentType,
          experienceMin: job.experienceMin,
          experienceMax: job.experienceMax,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryCurrency: job.salaryCurrency,
          sourceName: job.sourceName,
          applyUrl: job.applyUrl,
          companyId: company.id,
          expiresAt: new Date(job.publishedAt.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        };
      });
      // One round trip instead of hundreds of sequential updates.
      await prisma.$executeRawUnsafe(
        `UPDATE "Job" AS j SET
           "title" = x."title", "description" = x."description", "searchText" = x."searchText",
           "location" = x."location", "employmentType" = x."employmentType",
           "experienceMin" = x."experienceMin", "experienceMax" = x."experienceMax",
           "salaryMin" = x."salaryMin", "salaryMax" = x."salaryMax", "salaryCurrency" = x."salaryCurrency",
           "sourceName" = x."sourceName", "applyUrl" = x."applyUrl", "companyId" = x."companyId",
           "status" = 'PUBLISHED', "expiresAt" = x."expiresAt"::timestamptz, "embedding" = '{}', "updatedAt" = NOW()
         FROM jsonb_to_recordset($1::jsonb) AS x(
           "id" text, "title" text, "description" text, "searchText" text, "location" text, "employmentType" text,
           "experienceMin" float8, "experienceMax" float8, "salaryMin" int, "salaryMax" int, "salaryCurrency" text,
           "sourceName" text, "applyUrl" text, "companyId" text, "expiresAt" text
         )
         WHERE j."id" = x."id"`,
        JSON.stringify(rows),
      );
    }

    if (updatedIds.length) {
      await prisma.jobSkill.deleteMany({ where: { jobId: { in: updatedIds } } });
    }
    if (jobSkillRows.length) {
      const chunkSize = 500;
      for (let index = 0; index < jobSkillRows.length; index += chunkSize) {
        await prisma.jobSkill.createMany({ data: jobSkillRows.slice(index, index + chunkSize), skipDuplicates: true });
      }
    }

    await prisma.job.updateMany({
      where: { source: "EXTERNAL", status: "PUBLISHED", publishedAt: { lt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } },
      data: { status: "EXPIRED" },
    });

    return {
      fetched: collected.length,
      created: toCreate.length,
      updated: toUpdate.length,
      skipped: collected.length - jobs.length,
      companies: companies.size,
      skills: skills.size,
      providers,
      durationMs: Date.now() - startedAt,
    } satisfies SyncResult;
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

/** Runs an import at startup when the board is empty or the data is stale. */
export async function ensureExternalJobs(options: { maxAgeHours?: number } = {}) {
  if (process.env.JOB_SYNC_ENABLED === "false") return null;
  try {
    const count = await prisma.job.count({ where: { source: "EXTERNAL", status: "PUBLISHED" } });
    if (count === 0) return await syncExternalJobs({ force: true });
    const newest = await prisma.job.findFirst({ where: { source: "EXTERNAL" }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
    const maxAgeMs = (options.maxAgeHours ?? Number(process.env.JOB_SYNC_INTERVAL_HOURS ?? 6)) * 60 * 60 * 1000;
    if (!newest || Date.now() - newest.updatedAt.getTime() > maxAgeMs) return await syncExternalJobs({ force: true });
    return null;
  } catch (error) {
    console.warn(`[jobs] background import skipped: ${(error as Error).message}`);
    return null;
  }
}
