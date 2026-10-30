import "dotenv/config";
import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { ZodError } from "zod";
import { registerApiRoutes } from "./routes/api";
import { ensureExternalJobs, jobProviderStatus } from "./services/job-import";
import { emailDeliveryConfigured, emailDeliverySummary } from "./lib/email";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; roles: string[] };
    user: { sub: string; roles: string[] };
  }
}

export function createServer(): FastifyInstance {
  if (process.env.NODE_ENV === "production" && (!process.env.ACCESS_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET.length < 32)) {
    throw new Error("ACCESS_TOKEN_SECRET must contain at least 32 characters in production");
  }

  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: true,
    bodyLimit: 6 * 1024 * 1024,
  });

  // Treat an empty JSON body as `{}` so action endpoints accept clients that
  // always send Content-Type: application/json.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const text = String(body ?? "").trim();
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (error) {
      done(error as Error);
    }
  });

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(cookie);
  app.register(cors, {
    credentials: true,
    origin: (origin, callback) => {
      const configured = (process.env.FRONTEND_ORIGIN ?? "http://localhost:8080")
        .split(",").map((entry) => entry.trim());
      if (!origin || configured.includes(origin) || (process.env.NODE_ENV !== "production" && /^https?:\/\/localhost(:\d+)?$/.test(origin))) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed"), false);
    },
  });
  app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });
  app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  app.register(jwt, {
    secret: process.env.ACCESS_TOKEN_SECRET ?? "local-development-secret-change-before-deploy-32chars",
    cookie: { cookieName: "cm_access", signed: false },
  });

  app.register(swagger, {
    openapi: {
      info: { title: "CareerMatch API", version: "1.0.0", description: "REST API for candidate, recruiter, and career-matching workflows." },
      servers: [{ url: "/api/v1" }],
      tags: [
        { name: "auth", description: "Authentication and account security" },
        { name: "jobs", description: "Published jobs and candidate actions" },
        { name: "profile", description: "Candidate profile and resume data" },
        { name: "recruiter", description: "Recruiter-owned jobs and applicants" },
        { name: "recommendations", description: "Explainable job and career recommendations" },
      ],
    },
  });
  app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.get("/api/health", async () => ({ data: { status: "ok" } }));
  app.register(registerApiRoutes, { prefix: "/api/v1" });

  if (!emailDeliveryConfigured()) {
    app.log.warn(
      process.env.NODE_ENV === "production"
        ? "Email delivery is not configured (set RESEND_API_KEY or BREVO_API_KEY with EMAIL_FROM). Password reset and verification emails will NOT be sent."
        : "Email delivery is not configured (set RESEND_API_KEY or BREVO_API_KEY with EMAIL_FROM). Reset links appear in the API response and on /reset-password in development.",
    );
  } else {
    app.log.info(`Email delivery configured via ${emailDeliverySummary()}`);
  }

  // Warm the board from free public job APIs when it is empty or stale.
  // The check is a single count query after the first import; the import itself
  // runs in the background so it never delays a request.
  if (process.env.NODE_ENV !== "test") {
    const providerStatus = jobProviderStatus();
    app.log.info({ enabled: providerStatus.filter((provider) => provider.enabled).map((provider) => provider.name) }, "Job import providers");
    for (const provider of providerStatus.filter((entry) => !entry.enabled)) {
      app.log.info(
        { provider: provider.name, reason: provider.configured ? "disabled via JOB_IMPORT_DISABLED" : `needs ${provider.requires}` },
        "Job provider skipped",
      );
    }
    void ensureExternalJobs();
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Check the submitted fields.", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } });
    }
    const statusCode = (error as any).statusCode;
    if (statusCode && statusCode < 500) {
      return reply.code(statusCode).send({ error: { code: (error as any).code ?? "REQUEST_ERROR", message: String((error as any).message ?? "Request failed") } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
  });

  return app;
}
