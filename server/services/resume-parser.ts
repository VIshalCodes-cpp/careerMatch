import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { extractSkills, isKnownSkill, normalizeSkillName } from "../lib/skills";
import { tidyText } from "../lib/text";

export type ParsedResumeFields = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  links?: string[];
  summary?: string | null;
  skills: string[];
  education: string[];
  jobTitles: string[];
  certifications: string[];
  projects: string[];
  experienceYears?: number | null;
  parser: string;
  ocr: false;
};

export type ParsedResumeResult = { text: string; parsed: ParsedResumeFields; embedding: number[]; embeddingError?: string | null };

const MAX_TEXT = 120_000;

async function extractPdfText(bytes: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  if (totalPages > 200) throw new Error("PDF has too many pages");
  return Array.isArray(text) ? text.join("\n") : text;
}

async function extractDocxText(bytes: Buffer) {
  const result = await mammoth.extractRawText({ buffer: bytes });
  return result.value;
}

/** Extracts readable text from a PDF or DOCX buffer entirely in Node. */
export async function extractResumeText(bytes: Buffer, extension: "pdf" | "docx"): Promise<string> {
  if (extension === "pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("The uploaded file is not a valid PDF.");
    return tidyText(await extractPdfText(bytes));
  }
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error("The uploaded file is not a valid DOCX document.");
  return tidyText(await extractDocxText(bytes));
}

function cleanLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function looksLikeName(line: string) {
  const candidate = line.replace(/^name\s*:\s*/i, "");
  const words = candidate.split(" ");
  return (
    candidate.length >= 3 &&
    candidate.length <= 60 &&
    words.length <= 5 &&
    !/[@|/\\]|https?:|linkedin|github|resume|curriculum|vitae|\d{3}|(?:19|20)\d{2}|\b(?:engineer|developer|analyst|manager|designer|intern|consultant|scientist|architect|administrator|specialist|director|executive)\b/i.test(candidate) &&
    /^\p{L}[\p{L}.'’\- ]+$/u.test(candidate)
  );
}

const EDUCATION_HEADING = /^(?:education|educational background|academic background|academic qualifications|qualifications)\s*:?\s*$/i;
const SECTION_NAMES = [
  "professional experience", "work experience", "employment history", "career history", "experience",
  "technical skills", "core skills", "key skills", "skills", "projects", "project experience",
  "certifications", "certificates", "awards", "publications", "references", "professional summary",
  "summary", "profile", "objective", "location", "languages", "interests", "education", "educational background",
  "academic background", "academic qualifications", "qualifications",
];
const SECTION_HEADING = new RegExp(`^(?:${SECTION_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*:?...$`, "i");
const SECTION_PREFIX = new RegExp(`^(${SECTION_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*[:|–—-]\\s*(.+)$`, "i");
const DEGREE_LINE = /^(?:(?:19|20)\d{2}(?:\s*[-–]\s*(?:(?:19|20)\d{2}|present))?\s*[:|,-]?\s*)?(?:bachelor(?:'s)?(?:\s+of|\s+in|\s+degree)?|master(?:'s)?(?:\s+of|\s+in|\s+degree)?|b\.?\s?(?:tech(?:nology)?|e\.?|sc|s|a|com|eng|arch|pharm|ba|bba)|m\.?\s?(?:tech(?:nology)?|e\.?|sc|s|a|com|eng|pharm|phil)|mba|ph\.?\s?d\.?|doctorate|diploma|associate(?:'s)?(?:\s+degree)?|bca|mca|ca)\b/i;
const INSTITUTION_LINE = /\b(?:university|college|institute|school|academy)\b/i;
const TITLE_WORDS = /\b(engineer|developer|analyst|manager|designer|intern|consultant|scientist|architect|administrator|specialist|lead|director|executive|associate|product owner|researcher|technician|officer|coordinator)\b/i;

function resumeLines(text: string) {
  return text
    .replace(/[ \t]*[•▪●]\s*/g, "\n")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(SECTION_PREFIX);
      return match ? [match[1], match[2]].filter(Boolean) : [line];
    })
    .slice(0, 2500);
}

function sectionLines(lines: string[], heading: RegExp) {
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && SECTION_HEADING.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

function extractLocation(lines: string[]): string | null {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const explicit = line.match(/^(?:location|based in|address)\s*[:\-]\s*(.+)$/i);
    if (explicit?.[1] && explicit[1].length <= 100) return explicit[1];
    if (/^location\s*:?$/i.test(line) && lines[index + 1]?.length <= 100) return lines[index + 1];
  }
  for (const line of lines.slice(0, 8)) {
    for (const part of line.split(/[|•;]/).map(cleanLine)) {
      if (part.length > 100 || /@|https?:|linkedin|github|\d{5,}/i.test(part)) continue;
      if (/^[\p{L}][\p{L} .’'-]{1,40},\s*[\p{L}][\p{L} .’'-]{1,40}(?:,\s*[\p{L}][\p{L} .’'-]{1,40})?$/u.test(part)) return part;
    }
  }
  return null;
}

function extractJobTitles(lines: string[]) {
  const experienceLines = sectionLines(lines, /^(?:professional experience|work experience|employment history|career history|experience)\s*:?\s*$/i);
  const candidates = experienceLines.length ? experienceLines : lines;
  const titles: string[] = [];
  for (const line of candidates) {
    const segments = line.split(/\s*[|•]\s*/).map(cleanLine);
    const title = segments.find((segment) => TITLE_WORDS.test(segment));
    if (!title || title.length > 140) continue;
    const cleaned = title
      .replace(/\s+(?:at|@)\s+.+$/i, "")
      .replace(/\s*[\[(]?(?:(?:19|20)\d{2})(?:\s*[-–]\s*(?:(?:19|20)\d{2}|present|current))?[\])]?.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned && !titles.some((value) => value.toLowerCase() === cleaned.toLowerCase())) titles.push(cleaned);
    if (titles.length >= 10) break;
  }
  return titles;
}

function extractEducation(lines: string[]): string[] {
  const headingIndex = lines.findIndex((line) => EDUCATION_HEADING.test(line));
  let educationLines: string[];
  if (headingIndex >= 0) {
    const endIndex = lines.findIndex((line, index) => index > headingIndex && SECTION_HEADING.test(line));
    educationLines = lines.slice(headingIndex + 1, endIndex < 0 ? undefined : endIndex);
  } else {
    educationLines = lines.filter((line) => DEGREE_LINE.test(line));
  }
  const entries: string[] = [];
  for (let index = 0; index < educationLines.length; index++) {
    const line = educationLines[index];
    if (line.length > 140) continue;
    if (DEGREE_LINE.test(line)) {
      const institution = educationLines.slice(index + 1, index + 3).find((candidate) => candidate.length <= 140 && INSTITUTION_LINE.test(candidate));
      entries.push(institution ? `${line} — ${institution}` : line);
    } else if (INSTITUTION_LINE.test(line) && !/\b(?:worked|team|project|experienced|motivated|seeking|skills|communication)\b/i.test(line) && !entries.some((entry) => entry.endsWith(`— ${line}`))) {
      entries.push(line);
    }
    if (entries.length >= 10) break;
  }
  return [...new Set(entries)];
}

/** Rule-based resume field extraction. Runs with zero external services. */
export function parseResumeText(text: string): ParsedResumeFields {
  const lines = resumeLines(text);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone = text.match(/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/)?.[0]?.trim() ?? null;
  const name = lines.slice(0, 8).find(looksLikeName)?.replace(/^name\s*:\s*/i, "") ?? null;

  const skills = extractSkills(text, 60);

  const education = extractEducation(lines);

  const jobTitles = extractJobTitles(lines);

  const certifications = lines
    .filter((line) => /\b(certified|certification|certificate|aws certified|azure certified|gcp certified|cka|ckad|pmp|scrum master)\b/i.test(line))
    .slice(0, 10);

  const projects: string[] = [];
  projects.push(...sectionLines(lines, /^(?:projects?|project experience)\s*:?\s*$/i).filter((line) => line.length > 2).slice(0, 7));

  const yearsMentioned = [...text.matchAll(/\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi)].map((match) => Number(match[1])).filter((value) => value > 0 && value < 60);
  const experienceYears = yearsMentioned.length ? Math.max(...yearsMentioned) : null;

  const links = [...new Set([...text.matchAll(/https?:\/\/[^\s)>\]]+/gi)].map((match) => match[0].replace(/[.,;]$/, "")))].slice(0, 6);

  const summaryLines = sectionLines(lines, /^(?:professional summary|summary|profile|objective)\s*:?\s*$/i);
  const summaryFallback = lines.find((line) => line.length > 80 && !SECTION_HEADING.test(line) && !/education|experience|skills/i.test(line.slice(0, 24)));
  const summary = (summaryLines.length ? summaryLines.join(" ") : summaryFallback ?? "").slice(0, 700) || null;

  return {
    name,
    email,
    phone,
    location: extractLocation(lines),
    links,
    summary,
    skills,
    education,
    jobTitles,
    certifications,
    projects,
    experienceYears,
    parser: "Local rule-based extraction with normalized skill vocabulary (no external API key)",
    ocr: false,
  };
}

/**
 * Tries the optional self-hosted Python NLP service first (when configured),
 * then falls back to the built-in Node parser so uploads always work.
 */
export async function parseResumeBuffer(bytes: Buffer, filename: string, mimeType: string, extension: "pdf" | "docx"): Promise<ParsedResumeResult> {
  const text = await extractResumeText(bytes, extension);
  if (text.replace(/\s/g, "").length < 30) {
    throw new Error("No readable text found. Scanned image-only PDFs are not supported — upload a text-based PDF or DOCX.");
  }

  let parsed = parseResumeText(text);
  let embedding: number[] = [];
  let embeddingError: string | null = null;
  let parser = parsed.parser;

  const remoteUrl = process.env.ML_SERVICE_URL;
  if (remoteUrl) {
    try {
      const form = new FormData();
      form.append("file", new Blob([Uint8Array.from(bytes).buffer], { type: mimeType }), filename);
      const response = await fetch(`${remoteUrl.replace(/\/$/, "")}/parse`, {
        method: "POST",
        headers: process.env.ML_SERVICE_API_KEY ? { Authorization: `Bearer ${process.env.ML_SERVICE_API_KEY}` } : undefined,
        body: form,
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) {
        const payload = (await response.json()) as any;
        if (payload?.parsed) {
          parsed = {
            ...parsed,
            ...payload.parsed,
            skills: [...new Set([...(payload.parsed.skills ?? []), ...parsed.skills])].slice(0, 60),
            parser: "Self-hosted Python NLP service (spaCy + Sentence-Transformers)",
          };
          parser = parsed.parser;
          embedding = Array.isArray(payload.embedding) ? payload.embedding : [];
          embeddingError = payload.embeddingError ?? null;
        }
      }
    } catch {
      // The optional service is unavailable; local extraction above is authoritative.
    }
  }

  return { text: text.slice(0, MAX_TEXT), parsed: { ...parsed, parser }, embedding, embeddingError };
}

/** Canonicalizes and de-duplicates a list of user-entered skills. */
export function canonicalSkills(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const name = normalizeSkillName(value);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    output.push(name);
    if (output.length >= 100) break;
  }
  return output;
}

export { isKnownSkill };
