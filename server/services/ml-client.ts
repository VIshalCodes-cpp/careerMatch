export type ParsedResume = {
  text: string;
  parsed: { name?: string | null; email?: string | null; phone?: string | null; skills: string[]; education: string[]; jobTitles: string[]; certifications: string[]; projects: string[]; experienceYears?: number | null; [key: string]: unknown };
  embedding: number[];
  embeddingError?: string | null;
};

export async function parseResumeWithMl(bytes: Buffer, filename: string, contentType: string): Promise<ParsedResume> {
  const base = process.env.ML_SERVICE_URL;
  if (!base) throw new Error("Resume processing service is not configured (set ML_SERVICE_URL)");
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes).buffer], { type: contentType }), filename);
  const response = await fetch(`${base.replace(/\/$/, "")}/parse`, {
    method: "POST",
    headers: process.env.ML_SERVICE_API_KEY ? { Authorization: `Bearer ${process.env.ML_SERVICE_API_KEY}` } : undefined,
    body: form,
    signal: AbortSignal.timeout(25000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(payload.detail ?? `NLP service returned ${response.status}`);
  return payload as ParsedResume;
}
