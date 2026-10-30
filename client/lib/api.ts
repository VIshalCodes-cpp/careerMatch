export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code; }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
      .then((response) => response.ok).catch(() => false).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function api<T>(path: string, init: RequestInit = {}, retryAuth = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path.startsWith("/api/") ? path : `/api/v1${path}`, { ...init, headers, credentials: "include" });
  // Allow /auth/me to refresh an expired access token, but never retry the
  // endpoints that establish or tear down a session.
  const skipRefresh = /\/auth\/(login|register|refresh|google|logout|password-reset|email-verification|bootstrap-admin)/.test(path);
  if (response.status === 401 && retryAuth && !skipRefresh) {
    if (await refreshSession()) return api<T>(path, init, false);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(payload?.error?.details)
      ? payload.error.details.map((detail: { path?: string; message?: string }) => [detail.path, detail.message].filter(Boolean).join(": ")).join(" ")
      : "";
    const message = [payload?.error?.message ?? "Request failed.", details].filter(Boolean).join(" ");
    throw new ApiError(response.status, message, payload?.error?.code);
  }
  return payload as T;
}

export type User = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  unreadNotifications?: number;
  candidate?: { id?: string; headline?: string | null; currentRole?: string | null; location?: string | null; experienceYears?: number | null; skills?: number; resumeCount?: number } | null;
  recruiter?: { id?: string; title?: string | null; company?: { id: string; name: string; logoUrl?: string | null } | null } | null;
};
export type Envelope<T> = ApiEnvelope<T>;
import { ApiEnvelope } from "@shared/api";
