export type ApiEnvelope<T> = {
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiErrorResponse = {
  error: { code: string; message: string; details?: Array<{ path: string; message: string }> };
};

export type AccountRole = "CANDIDATE" | "RECRUITER" | "ADMIN";

export type JobStatus = "DRAFT" | "PUBLISHED" | "CLOSED" | "EXPIRED";
