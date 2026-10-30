/**
 * Transactional email. Two HTTPS transports are supported so the app can send
 * password resets without owning a domain:
 *
 *  - Resend (`RESEND_API_KEY`) — needs a verified domain; without one it can
 *    only deliver to the address that owns the Resend account.
 *  - Brevo  (`BREVO_API_KEY`)  — verifies a single sender address instead of a
 *    whole domain, so it can deliver to any recipient with no DNS setup.
 *
 * Both are optional: without either, the app still runs and development shows
 * the reset link inline instead.
 */

export type EmailTransport = "resend" | "brevo";

export type EmailResult = { ok: boolean; transport?: EmailTransport; detail?: string };

type Sender = { raw: string; email: string; name: string | null };

function stringEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Accepts both `no-reply@example.com` and `CareerMatch <no-reply@example.com>`. */
function sender(): Sender | null {
  const raw = stringEnv("EMAIL_FROM");
  if (!raw) return null;
  const bracket = raw.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (bracket) {
    const email = bracket[2].trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
    return { raw, email, name: bracket[1].replace(/^["']|["']$/g, "").trim() || null };
  }
  return /^[^\s@]+@[^\s@]+$/.test(raw) ? { raw, email: raw, name: null } : null;
}

export function emailTransport(): EmailTransport | null {
  if (!sender()) return null;
  if (stringEnv("RESEND_API_KEY")) return "resend";
  if (stringEnv("BREVO_API_KEY")) return "brevo";
  return null;
}

export function emailDeliveryConfigured(): boolean {
  return emailTransport() !== null;
}

/** Short human-readable summary for startup logs. */
export function emailDeliverySummary(): string {
  const transport = emailTransport();
  if (!transport) return "not configured";
  return `${transport} as ${sender()!.email}`;
}

async function failureDetail(provider: string, response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return `${provider} returned ${response.status}: ${body.slice(0, 300)}`;
}

async function sendViaResend(to: string, subject: string, text: string): Promise<EmailResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${stringEnv("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: sender()!.raw, to: [to], subject, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (response.ok) return { ok: true, transport: "resend" };
  return { ok: false, transport: "resend", detail: await failureDetail("Resend", response) };
}

async function sendViaBrevo(to: string, subject: string, text: string): Promise<EmailResult> {
  const { email, name } = sender()!;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": stringEnv("BREVO_API_KEY")!,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: name ? { name, email } : { email },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (response.ok) return { ok: true, transport: "brevo" };
  return { ok: false, transport: "brevo", detail: await failureDetail("Brevo", response) };
}

export async function sendEmail(to: string, subject: string, text: string): Promise<EmailResult> {
  const transport = emailTransport();
  if (!transport) return { ok: false, detail: "Set RESEND_API_KEY or BREVO_API_KEY together with EMAIL_FROM" };
  try {
    return transport === "resend" ? await sendViaResend(to, subject, text) : await sendViaBrevo(to, subject, text);
  } catch (error) {
    return { ok: false, transport, detail: error instanceof Error ? error.message : String(error) };
  }
}
