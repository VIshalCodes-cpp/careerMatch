import { afterEach, describe, expect, it } from "vitest";
import { jobProviderStatus, normalizeAdzunaJob, normalizeJoobleJob } from "./job-import";

const INDIA = { code: "in", currency: "INR", name: "India" };

const adzunaResult = {
  id: "4433221",
  title: "Senior React Developer",
  description: "<p>Build and ship React and TypeScript products. 5+ years of experience with Node.js and PostgreSQL.</p>",
  redirect_url: "https://www.adzuna.in/land/ad/4433221",
  created: "2026-10-20T09:15:00Z",
  company: { display_name: "Acme Technologies" },
  location: { area: ["India", "Karnataka", "Bengaluru"], display_name: "Bengaluru, Karnataka" },
  category: { label: "IT Jobs", tag: "it-jobs" },
  salary_min: 1_800_000,
  salary_max: 2_600_000,
  salary_is_predicted: "0",
  contract_type: "permanent",
  contract_time: "full_time",
};

const joobleResult = {
  id: 98765,
  title: "Backend Engineer (Node.js)",
  location: "Pune, Maharashtra",
  snippet: "Work on Node.js and PostgreSQL services used by millions of customers. 3+ years of experience.",
  salary: "₹12,00,000 - ₹18,00,000 a year",
  source: "foundit",
  type: "Full-time",
  link: "https://in.jooble.org/desc/98765",
  company: "Nimbus Systems",
  updated: "2026-10-23T06:30:00.000000",
};

afterEach(() => {
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
  delete process.env.JOOBLE_API_KEY;
  delete process.env.JOB_IMPORT_DISABLED;
});

describe("Adzuna India normalization", () => {
  it("keeps the India listing, INR salary, and a link back to the original ad", () => {
    const job = normalizeAdzunaJob(adzunaResult, INDIA)!;
    expect(job).not.toBeNull();
    expect(job.sourceName).toBe("Adzuna");
    expect(job.sourceJobId).toBe("adzuna:in:4433221");
    expect(job.title).toBe("Senior React Developer");
    expect(job.companyName).toBe("Acme Technologies");
    expect(job.location).toContain("Bengaluru");
    expect(job.employmentType).toBe("Full-time");
    expect(job.salaryMin).toBe(1_800_000);
    expect(job.salaryMax).toBe(2_600_000);
    expect(job.salaryCurrency).toBe("INR");
    expect(job.applyUrl).toBe("https://www.adzuna.in/land/ad/4433221");
    expect(job.publishedAt.toISOString()).toBe("2026-10-20T09:15:00.000Z");
    expect(job.skills.some((skill) => skill.name.toLowerCase() === "react")).toBe(true);
    expect(job.description).not.toContain("<p>");
  });

  it("drops modelled pay instead of presenting it as a real salary", () => {
    const job = normalizeAdzunaJob({ ...adzunaResult, salary_is_predicted: "1" }, INDIA)!;
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.salaryCurrency).toBeNull();
  });

  it("falls back to the country when a listing has no display location", () => {
    const job = normalizeAdzunaJob({ ...adzunaResult, location: { area: [] } }, INDIA)!;
    expect(job.location).toBe("India");
  });

  it("rejects a result with no redirect URL", () => {
    expect(normalizeAdzunaJob({ ...adzunaResult, redirect_url: null }, INDIA)).toBeNull();
  });
});

describe("Jooble normalization", () => {
  it("reads the snippet, Indian salary text, and posting link", () => {
    const job = normalizeJoobleJob(joobleResult)!;
    expect(job).not.toBeNull();
    expect(job.sourceName).toBe("Jooble");
    expect(job.sourceJobId).toBe("jooble:98765");
    expect(job.companyName).toBe("Nimbus Systems");
    expect(job.location).toBe("Pune, Maharashtra");
    expect(job.employmentType).toBe("Full-time");
    expect(job.salaryMin).toBe(1_200_000);
    expect(job.salaryMax).toBe(1_800_000);
    expect(job.salaryCurrency).toBe("INR");
    expect(job.applyUrl).toBe("https://in.jooble.org/desc/98765");
    expect(job.publishedAt.toISOString()).toBe("2026-10-23T06:30:00.000Z");
  });

  it("rejects an entry without a link or a usable description", () => {
    expect(normalizeJoobleJob({ ...joobleResult, link: "" })).toBeNull();
    expect(normalizeJoobleJob({ ...joobleResult, snippet: "Too short." })).toBeNull();
  });
});

describe("provider configuration", () => {
  const findProvider = (name: string) => jobProviderStatus().find((provider) => provider.name === name)!;

  it("keeps keyed feeds off until both values are present", () => {
    expect(findProvider("Adzuna").enabled).toBe(false);
    process.env.ADZUNA_APP_ID = "app-id";
    expect(findProvider("Adzuna").enabled).toBe(false);
    process.env.ADZUNA_APP_KEY = "app-key";
    expect(findProvider("Adzuna").enabled).toBe(true);
    expect(findProvider("Jooble").enabled).toBe(false);
    process.env.JOOBLE_API_KEY = "jooble-key";
    expect(findProvider("Jooble").enabled).toBe(true);
  });

  it("honors JOB_IMPORT_DISABLED for keyless feeds", () => {
    expect(findProvider("Remotive").enabled).toBe(true);
    process.env.JOB_IMPORT_DISABLED = "arbeitnow, remotive";
    expect(findProvider("Remotive").enabled).toBe(false);
    expect(findProvider("Arbeitnow").enabled).toBe(false);
    expect(findProvider("RemoteOK").enabled).toBe(true);
  });
});
