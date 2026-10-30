import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailDeliveryConfigured, emailDeliverySummary, emailTransport, sendEmail } from "./email";

const MANAGED = ["RESEND_API_KEY", "BREVO_API_KEY", "EMAIL_FROM"] as const;

function clearEnv() {
  for (const name of MANAGED) delete process.env[name];
}

function stubFetch(response: Response) {
  const spy = vi.fn(async (_input: any, _init?: any) => response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

afterEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

describe("email transport selection", () => {
  it("reports no delivery until a key and sender are configured", () => {
    expect(emailTransport()).toBeNull();
    expect(emailDeliveryConfigured()).toBe(false);
    expect(emailDeliverySummary()).toBe("not configured");
  });

  it("requires a valid sender address", () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.EMAIL_FROM = "not-an-email";
    expect(emailTransport()).toBeNull();
  });

  it("prefers Resend when both transports are configured", () => {
    process.env.RESEND_API_KEY = "resend-key";
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.EMAIL_FROM = "CareerMatch <no-reply@example.com>";
    expect(emailTransport()).toBe("resend");
    expect(emailDeliverySummary()).toBe("resend as no-reply@example.com");
  });

  it("uses Brevo when only Brevo is configured", () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.EMAIL_FROM = "CareerMatch <onboarding@example.com>";
    expect(emailTransport()).toBe("brevo");
  });
});

describe("sending", () => {
  it("sends through Brevo with a parsed sender address", async () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.EMAIL_FROM = "CareerMatch <hello@example.com>";
    const spy = stubFetch(new Response(JSON.stringify({ messageId: "abc" }), { status: 201 }));

    const result = await sendEmail("candidate@example.com", "Reset your password", "Use this link");

    expect(result).toMatchObject({ ok: true, transport: "brevo" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init as any).headers["api-key"]).toBe("brevo-key");
    const body = JSON.parse((init as any).body);
    expect(body).toEqual({
      sender: { name: "CareerMatch", email: "hello@example.com" },
      to: [{ email: "candidate@example.com" }],
      subject: "Reset your password",
      textContent: "Use this link",
    });
  });

  it("sends through Resend and keeps the display name in the From header", async () => {
    process.env.RESEND_API_KEY = "resend-key";
    process.env.EMAIL_FROM = "CareerMatch <onboarding@resend.dev>";
    const spy = stubFetch(new Response(JSON.stringify({ id: "abc" }), { status: 200 }));

    const result = await sendEmail("candidate@example.com", "Reset your password", "Use this link");

    expect(result).toMatchObject({ ok: true, transport: "resend" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as any).headers.Authorization).toBe("Bearer resend-key");
    const body = JSON.parse((init as any).body);
    expect(body.from).toBe("CareerMatch <onboarding@resend.dev>");
    expect(body.to).toEqual(["candidate@example.com"]);
  });

  it("surfaces the provider error body instead of failing silently", async () => {
    process.env.BREVO_API_KEY = "brevo-key";
    process.env.EMAIL_FROM = "hello@example.com";
    stubFetch(new Response(JSON.stringify({ message: "Sender not verified" }), { status: 403 }));

    const result = await sendEmail("candidate@example.com", "Reset", "Link");

    expect(result.ok).toBe(false);
    expect(result.transport).toBe("brevo");
    expect(result.detail).toContain("403");
    expect(result.detail).toContain("Sender not verified");
  });

  it("returns a reason when no transport is configured", async () => {
    const result = await sendEmail("candidate@example.com", "Reset", "Link");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("RESEND_API_KEY or BREVO_API_KEY");
  });
});
