import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import argon2 from "argon2";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { prisma } from "../lib/database";
import { authenticate, requireRole } from "../lib/auth";
import { deleteResumeFile, loadResume, openResume, storeResume } from "../services/resume-storage";
import { canonicalSkills, parseResumeBuffer } from "../services/resume-parser";
import { calibrateSemantic, plainExcerpt, tfidfSimilarities } from "../lib/text";
import { ensureExternalJobs, syncExternalJobs } from "../services/job-import";
import { experienceCompatibility, skillOverlap, weightedFit } from "../lib/matching";
import { emailDeliveryConfigured, sendEmail } from "../lib/email";

const ACCESS_COOKIE = "cm_access";
const REFRESH_COOKIE = "cm_refresh";
const googleOAuthClient = new OAuth2Client();
const accessAge = 15 * 60 * 1000;
const refreshAge = 7 * 24 * 60 * 60 * 1000;
const cookieOptions = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge });
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const newOpaqueToken = () => randomBytes(48).toString("base64url");
const wrap = (data: unknown) => ({ data });
const fail = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });
const userRoles = (user: { roles: { role: string }[] }) => user.roles.map((role) => role.role);
const httpsUrl = (max: number) => z.string().max(max).url().refine((value) => new URL(value).protocol === "https:", "Use an HTTPS URL");
const weight = (key: string, fallback: number) => {
  const configured = Number(process.env[key] ?? fallback);
  return Number.isFinite(configured) && configured >= 0 ? configured : fallback;
};
const CAREER_TRANSITIONS = [
  { from: "software developer", to: "senior software engineer", skills: ["system design", "testing", "cloud computing"], explanation: "A common progression from software delivery into ownership of larger systems and technical decisions." },
  { from: "software developer", to: "machine learning engineer", skills: ["python", "machine learning", "statistics", "model deployment"], explanation: "Builds on software engineering foundations and adds applied ML, statistics, and production model skills." },
  { from: "data analyst", to: "data scientist", skills: ["python", "statistics", "machine learning", "data visualization"], explanation: "Extends analytical work toward statistical modelling and predictive methods." },
  { from: "data engineer", to: "machine learning engineer", skills: ["python", "machine learning", "model deployment", "mlops"], explanation: "Uses data-pipeline experience as a base for reliable model training and serving systems." },
  { from: "frontend developer", to: "full stack engineer", skills: ["node.js", "api design", "sql", "backend development"], explanation: "Adds server-side and data-layer skills to existing interface engineering experience." },
  { from: "backend developer", to: "solution architect", skills: ["system design", "cloud computing", "security", "stakeholder communication"], explanation: "Builds on service experience with broader architecture, security, and cross-team design." },
];
const matchingCareerTransitions = (currentRole: string, targetRole: string) => {
  const current = currentRole.toLowerCase(); const goal = targetRole.toLowerCase();
  return CAREER_TRANSITIONS.filter((path) => (!current || path.from.includes(current) || current.includes(path.from) || (current.includes("developer") && path.from === "software developer")) && (!goal || path.to.includes(goal) || goal.includes(path.to)));
};

/** Reads the session when present without rejecting anonymous visitors. */
async function optionalUser(request: any): Promise<{ sub: string; roles: string[] } | null> {
  try {
    const payload = await (request as FastifyRequest).jwtVerify<{ sub: string; roles: string[] }>();
    return payload ?? null;
  } catch {
    return null;
  }
}

const JOB_CARD_INCLUDE = {
  company: { select: { id: true, name: true, logoUrl: true, website: true, location: true } },
  skills: { include: { skill: { select: { id: true, name: true, normalizedName: true } } } },
} as const;

/** Lightweight projection used for ranking hundreds of jobs without loading full descriptions. */
const JOB_RANK_SELECT = {
  id: true, source: true, sourceName: true, sourceJobId: true, title: true, searchText: true, location: true,
  employmentType: true, experienceMin: true, experienceMax: true, salaryMin: true, salaryMax: true, salaryCurrency: true,
  status: true, publishedAt: true, expiresAt: true, applyUrl: true, companyId: true, createdById: true, createdAt: true, updatedAt: true,
  company: { select: { id: true, name: true, logoUrl: true, website: true, location: true } },
  skills: { include: { skill: { select: { id: true, name: true, normalizedName: true } } } },
} as const;

const jobCard = (job: any, options: { fullDescription?: boolean } = {}) => ({
  ...job,
  // Ranking-only and binary fields never belong in an API payload.
  searchText: undefined,
  embedding: undefined,
  description: options.fullDescription ? job.description : undefined,
  excerpt: options.fullDescription ? undefined : plainExcerpt(job.description ?? job.searchText ?? "", 230),
  skills: (job.skills ?? []).map((entry: any) => ({ id: entry.skill.id, name: entry.skill.name, normalizedName: entry.skill.normalizedName, required: entry.required })),
});

/** Maps normalized skill keys back to the display names used in a listing. */
const displaySkillNames = (values: string[], skills: any[]) => {
  const names = new Map<string, string>();
  for (const entry of skills ?? []) {
    const normalized = entry.skill?.normalizedName ?? entry.normalizedName;
    const name = entry.skill?.name ?? entry.name;
    if (normalized && name) names.set(normalized, name);
  }
  return values.map((value) => names.get(value) ?? value);
};

async function notify(userId: string, title: string, message: string) {
  await prisma.notification.create({ data: { userId, title: title.slice(0, 180), message: message.slice(0, 2000) } }).catch(() => undefined);
}

async function interactionFlags(userId: string | null | undefined, jobIds: string[]) {
  if (!userId || !jobIds.length) return { saved: new Set<string>(), applied: new Set<string>() };
  const [saved, applied] = await Promise.all([
    prisma.savedJob.findMany({ where: { userId, jobId: { in: jobIds } }, select: { jobId: true } }),
    prisma.jobApplication.findMany({ where: { userId, jobId: { in: jobIds } }, select: { jobId: true, status: true } }),
  ]);
  return { saved: new Set(saved.map((entry) => entry.jobId)), applied: new Set(applied.filter((entry) => entry.status !== "WITHDRAWN").map((entry) => entry.jobId)) };
}

function candidateText(profile: any, resumeText?: string | null) {
  return [
    profile?.headline, profile?.summary, profile?.currentRole, profile?.careerGoal,
    ...(profile?.skills ?? []).map((entry: any) => entry.skill?.name ?? entry.name ?? ""),
    ...(profile?.experience ?? []).map((entry: any) => `${entry.title} ${entry.company ?? ""} ${entry.description ?? ""}`),
    ...(profile?.education ?? []).map((entry: any) => `${entry.degree ?? ""} ${entry.field ?? ""} ${entry.institution ?? ""}`),
    ...(profile?.certifications ?? []).map((entry: any) => entry.name ?? ""),
    resumeText?.slice(0, 4000),
  ].filter(Boolean).join("\n");
}

function jobText(job: any) {
  const description = (job.description ?? job.searchText ?? "").slice(0, 4000);
  return [job.title, description, job.location, job.employmentType, ...(job.skills ?? []).map((entry: any) => entry.skill?.name ?? entry.name ?? "")].filter(Boolean).join("\n");
}


async function issueSession(app: FastifyInstance, reply: FastifyReply, user: { id: string; roles: { role: string }[] }) {
  const roles = userRoles(user);
  const access = app.jwt.sign({ sub: user.id, roles }, { expiresIn: "15m" });
  const refresh = newOpaqueToken();
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: tokenHash(refresh), expiresAt: new Date(Date.now() + refreshAge) } });
  reply.setCookie(ACCESS_COOKIE, access, cookieOptions(accessAge));
  reply.setCookie(REFRESH_COOKIE, refresh, cookieOptions(refreshAge));
}

function publicUser(user: any) {
  return { id: user.id, email: user.email, name: user.name, roles: userRoles(user) };
}

const registerInput = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
  role: z.enum(["CANDIDATE", "RECRUITER"]).default("CANDIDATE"),
});
const loginInput = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: z.string().min(1).max(128) });

export async function registerApiRoutes(app: FastifyInstance) {
  app.post("/auth/register", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }, schema: { tags: ["auth"], summary: "Create a candidate or recruiter account" } }, async (request, reply) => {
    const input = registerInput.parse(request.body);
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) return fail(reply, 409, "EMAIL_IN_USE", "An account already exists for this email.");
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const user = await prisma.user.create({
      data: {
        email: input.email, name: input.name, passwordHash,
        roles: { create: { role: input.role } },
        ...(input.role === "CANDIDATE" ? { candidate: { create: {} } } : { recruiter: { create: {} } }),
      }, include: { roles: true, candidate: true, recruiter: true },
    });
    await issueSession(app, reply, user);
    if (emailDeliveryConfigured()) {
      const verification = newOpaqueToken();
      await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash: tokenHash(verification), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
      const verifyUrl = `${process.env.FRONTEND_ORIGIN?.split(",")[0] ?? "http://localhost:8080"}/verify-email?token=${encodeURIComponent(verification)}`;
      const delivery = await sendEmail(user.email, "Verify your CareerMatch email", `Verify your email within 24 hours: ${verifyUrl}`);
      if (!delivery.ok) request.log.error({ userId: user.id, detail: delivery.detail }, "Email verification delivery failed");
    }
    await prisma.auditLog.create({ data: { actorId: user.id, action: "ACCOUNT_REGISTERED", targetType: "User", targetId: user.id } });
    return reply.code(201).send(wrap(publicUser(user)));
  });

  app.post("/auth/login", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } }, schema: { tags: ["auth"], summary: "Sign in" } }, async (request, reply) => {
    const input = loginInput.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: input.email }, include: { roles: true, candidate: true, recruiter: true } });
    if (!user || user.disabledAt || !user.passwordHash || !(await argon2.verify(user.passwordHash, input.password))) return fail(reply, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    await issueSession(app, reply, user);
    return reply.send(wrap(publicUser(user)));
  });

  app.post("/auth/google", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } }, schema: { tags: ["auth"], summary: "Sign in or register with Google" } }, async (request, reply) => {
    const input = z.object({
      credential: z.string().min(1).max(8192),
      flow: z.enum(["login", "register"]),
      role: z.enum(["CANDIDATE", "RECRUITER"]).default("CANDIDATE"),
    }).parse(request.body);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return fail(reply, 503, "GOOGLE_AUTH_UNAVAILABLE", "Google sign-in is not configured.");

    let claims;
    try {
      const ticket = await googleOAuthClient.verifyIdToken({ idToken: input.credential, audience: clientId });
      claims = ticket.getPayload();
    } catch (error) {
      request.log.warn({ err: error }, "Google ID token verification failed");
      return fail(reply, 401, "GOOGLE_CREDENTIAL_INVALID", "Google sign-in could not be verified.");
    }
    if (!claims?.sub || !claims.email || claims.email_verified !== true) {
      return fail(reply, 401, "GOOGLE_EMAIL_UNVERIFIED", "Use a Google account with a verified email address.");
    }

    const identity = await prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: "GOOGLE", providerAccountId: claims.sub } },
      include: { user: { include: { roles: true, candidate: true, recruiter: true, oauthAccounts: { where: { provider: "GOOGLE" } } } } },
    });
    let user = identity?.user;
    let created = false;

    if (!user) {
      const email = claims.email.toLowerCase();
      user = await prisma.user.findUnique({
        where: { email },
        include: { roles: true, candidate: true, recruiter: true, oauthAccounts: { where: { provider: "GOOGLE" } } },
      });

      if (user?.oauthAccounts.length) {
        return fail(reply, 409, "GOOGLE_ACCOUNT_MISMATCH", "This email is linked to a different Google account.");
      }
      if (!user) {
        if (input.flow === "login") return fail(reply, 404, "ACCOUNT_NOT_FOUND", "No account is linked to this Google account. Create one first.");
        const role = input.role;
        user = await prisma.user.create({
          data: {
            email,
            name: (claims.name || email.split("@")[0]).slice(0, 160),
            emailVerifiedAt: new Date(),
            oauthAccounts: { create: { provider: "GOOGLE", providerAccountId: claims.sub } },
            roles: { create: { role } },
            ...(role === "CANDIDATE" ? { candidate: { create: {} } } : { recruiter: { create: {} } }),
          },
          include: { roles: true, candidate: true, recruiter: true, oauthAccounts: { where: { provider: "GOOGLE" } } },
        });
        created = true;
      } else {
        if (user.disabledAt) return fail(reply, 403, "ACCOUNT_DISABLED", "This account is disabled.");
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
            oauthAccounts: { create: { provider: "GOOGLE", providerAccountId: claims.sub } },
          },
          include: { roles: true, candidate: true, recruiter: true, oauthAccounts: { where: { provider: "GOOGLE" } } },
        });
      }
    }

    if (user.disabledAt) return fail(reply, 403, "ACCOUNT_DISABLED", "This account is disabled.");
    if (created) {
      await prisma.auditLog.create({ data: { actorId: user.id, action: "ACCOUNT_REGISTERED", targetType: "User", targetId: user.id } });
    }
    await issueSession(app, reply, user);
    return reply.code(created ? 201 : 200).send(wrap(publicUser(user)));
  });

  app.post("/auth/refresh", async (request, reply) => {
    const token = (request.cookies as any)?.[REFRESH_COOKIE];
    if (!token || typeof token !== "string") return fail(reply, 401, "SESSION_EXPIRED", "Sign in again to continue.");
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: { include: { roles: true } } } });
    if (!existing || existing.revokedAt || existing.expiresAt < new Date() || existing.user.disabledAt) {
      reply.clearCookie(ACCESS_COOKIE, { path: "/" }); reply.clearCookie(REFRESH_COOKIE, { path: "/" });
      return fail(reply, 401, "SESSION_EXPIRED", "Sign in again to continue.");
    }
    const next = newOpaqueToken();
    const rotated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({ where: { id: existing.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
      if (claimed.count !== 1) return false;
      await tx.refreshToken.create({ data: { userId: existing.userId, tokenHash: tokenHash(next), expiresAt: new Date(Date.now() + refreshAge) } });
      return true;
    }, { timeout: 15000 });
    if (!rotated) return fail(reply, 401, "SESSION_EXPIRED", "Sign in again to continue.");
    const access = app.jwt.sign({ sub: existing.user.id, roles: userRoles(existing.user) }, { expiresIn: "15m" });
    reply.setCookie(ACCESS_COOKIE, access, cookieOptions(accessAge));
    reply.setCookie(REFRESH_COOKIE, next, cookieOptions(refreshAge));
    return reply.send(wrap({ refreshed: true }));
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = (request.cookies as any)?.[REFRESH_COOKIE];
    if (token) await prisma.refreshToken.updateMany({ where: { tokenHash: tokenHash(token), revokedAt: null }, data: { revokedAt: new Date() } });
    reply.clearCookie(ACCESS_COOKIE, { path: "/" }); reply.clearCookie(REFRESH_COOKIE, { path: "/" });
    return reply.send(wrap({ loggedOut: true }));
  });

  app.get("/auth/me", { preHandler: authenticate, schema: { tags: ["auth"], summary: "Return the signed-in account" } }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub }, include: { roles: true, candidate: { include: { skills: { include: { skill: true } } } }, recruiter: { include: { company: true } } }, relationLoadStrategy: "join" });
    if (!user || user.disabledAt) return fail(reply, 401, "UNAUTHENTICATED", "Sign in to continue.");
    const [unreadNotifications, resumeCount] = await Promise.all([
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      user.candidate ? prisma.resume.count({ where: { userId: user.id, status: { in: ["PROCESSED", "QUEUED", "PROCESSING"] } } }) : Promise.resolve(0),
    ]);
    return reply.send(wrap({
      ...publicUser(user),
      unreadNotifications,
      candidate: user.candidate ? { id: user.candidate.id, headline: user.candidate.headline, currentRole: user.candidate.currentRole, location: user.candidate.location, experienceYears: user.candidate.experienceYears, skills: user.candidate.skills.length, resumeCount } : null,
      recruiter: user.recruiter ? { id: user.recruiter.id, title: user.recruiter.title, company: user.recruiter.company ? { id: user.recruiter.company.id, name: user.recruiter.company.name, logoUrl: user.recruiter.company.logoUrl } : null } : null,
    }));
  });

  app.patch("/me/account", { preHandler: authenticate, schema: { tags: ["auth"], summary: "Update the signed-in account's display name" } }, async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(2).max(160) }).parse(request.body);
    const user = await prisma.user.update({ where: { id: request.user.sub }, data: { name: input.name }, include: { roles: true } });
    return reply.send(wrap(publicUser(user)));
  });

  app.post("/auth/change-password", { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }, schema: { tags: ["auth"], summary: "Change password and revoke other sessions" } }, async (request, reply) => {
    const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(128) }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, input.currentPassword))) return fail(reply, 400, "INVALID_PASSWORD", "Current password is incorrect.");
    const hash = await argon2.hash(input.newPassword, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    // Keep the session that made the change; sign out every other device.
    const currentRefresh = (request.cookies as any)?.[REFRESH_COOKIE];
    const keepTokenHash = typeof currentRefresh === "string" && currentRefresh ? tokenHash(currentRefresh) : null;
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null, ...(keepTokenHash ? { tokenHash: { not: keepTokenHash } } : {}) },
        data: { revokedAt: new Date() },
      }),
    ]);
    return reply.send(wrap({ changed: true }));
  });

  app.post("/auth/password-reset/request", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }, schema: { tags: ["auth"], summary: "Request a password reset" } }, async (request, reply) => {
    const { email } = z.object({ email: z.string().email().transform((value) => value.toLowerCase()) }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { email } });
    const result: Record<string, unknown> = { accepted: true };
    if (user) {
      const raw = newOpaqueToken();
      await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: tokenHash(raw), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
      const resetUrl = `${process.env.FRONTEND_ORIGIN?.split(",")[0] ?? "http://localhost:8080"}/reset-password?token=${encodeURIComponent(raw)}`;
      if (emailDeliveryConfigured()) {
        const delivery = await sendEmail(user.email, "Reset your CareerMatch password", `Use this link within 30 minutes to reset your password: ${resetUrl}`);
        if (!delivery.ok) request.log.error({ userId: user.id, detail: delivery.detail }, "Password reset email delivery failed");
      } else if (process.env.NODE_ENV !== "production") {
        result.developmentResetUrl = resetUrl;
      } else {
        // Never leave a production reset silently undeliverable: the caller still
        // gets the generic response, but ops sees exactly why no email went out.
        request.log.error({ userId: user.id }, "Password reset requested but email delivery is not configured; set RESEND_API_KEY and EMAIL_FROM");
      }
    }
    return reply.send(wrap(result));
  });

  app.post("/auth/password-reset/complete", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }, schema: { tags: ["auth"], summary: "Complete a password reset" } }, async (request, reply) => {
    const input = z.object({ token: z.string().min(30), password: z.string().min(10).max(128) }).parse(request.body);
    const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(input.token) } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) return fail(reply, 400, "RESET_TOKEN_INVALID", "This reset link is invalid or expired.");
    const hash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await prisma.$transaction([
      prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: hash } }),
      prisma.refreshToken.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return reply.send(wrap({ reset: true }));
  });

  app.post("/auth/email-verification/complete", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } }, schema: { tags: ["auth"], summary: "Verify an email address when delivery is configured" } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(30) }).parse(request.body);
    const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) return fail(reply, 400, "VERIFY_TOKEN_INVALID", "This verification link is invalid or expired.");
    await prisma.$transaction([prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }), prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } })]);
    return reply.send(wrap({ verified: true }));
  });

  app.post("/auth/bootstrap-admin", { config: { rateLimit: { max: 2, timeWindow: "1 hour" } }, schema: { tags: ["auth"], summary: "Promote an existing account with the one-time deployment bootstrap secret" } }, async (request, reply) => {
    const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
    if (!secret) return fail(reply, 404, "NOT_FOUND", "This endpoint is disabled.");
    const input = z.object({ email: z.string().email(), secret: z.string().min(1) }).parse(request.body);
    if (input.secret !== secret) return fail(reply, 403, "FORBIDDEN", "Invalid bootstrap secret.");
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user) return fail(reply, 404, "USER_NOT_FOUND", "Create the account before promoting it.");
    await prisma.userRole.upsert({ where: { userId_role: { userId: user.id, role: "ADMIN" } }, create: { userId: user.id, role: "ADMIN" }, update: {} });
    await prisma.auditLog.create({ data: { actorId: user.id, action: "ADMIN_BOOTSTRAP", targetType: "User", targetId: user.id } });
    return reply.send(wrap({ promoted: true }));
  });

  await registerJobs(app);
  await registerProfiles(app);
  await registerRecruiterRoutes(app);
  await registerRecommendations(app);
  await registerResumeRoutes(app);
  await registerNotifications(app);
  await registerCompanies(app);
  await registerAdminRoutes(app);

  app.get("/stats", { schema: { tags: ["jobs"], summary: "Public marketplace counters for the landing page" } }, async (_request, reply) => {
    const [jobs, companies, candidates, remoteJobs, newThisWeek, sourceRows] = await Promise.all([
      prisma.job.count({ where: { status: "PUBLISHED" } }),
      prisma.company.count(),
      prisma.userRole.count({ where: { role: "CANDIDATE" } }),
      prisma.job.count({ where: { status: "PUBLISHED", location: { contains: "remote", mode: "insensitive" } } }),
      prisma.job.count({ where: { status: "PUBLISHED", publishedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
      prisma.job.groupBy({ by: ["sourceName"], where: { status: "PUBLISHED", source: "EXTERNAL" }, _count: { _all: true } }),
    ]);
    const sources = sourceRows
      .filter((row) => row.sourceName)
      .sort((left, right) => right._count._all - left._count._all)
      .map((row) => row.sourceName!);
    return reply.send(wrap({ jobs, companies, candidates, remoteJobs, newThisWeek, sources }));
  });
}

async function registerJobs(app: FastifyInstance) {
  app.get("/jobs", { schema: { tags: ["jobs"], summary: "Search published jobs with filters and pagination" } }, async (request, reply) => {
    const query = z.object({
      q: z.string().trim().max(120).optional(),
      location: z.string().trim().max(180).optional(),
      employmentType: z.string().trim().max(80).optional(),
      remote: z.enum(["true", "false"]).optional(),
      source: z.enum(["all", "recruiter", "external"]).default("all"),
      experience: z.coerce.number().min(0).max(60).optional(),
      salaryMin: z.coerce.number().int().min(0).max(100_000_000).optional(),
      sort: z.enum(["newest", "oldest", "salary", "company"]).default("newest"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(12),
    }).parse(request.query);

    const now = new Date();
    const conditions: any[] = [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }];
    if (query.location) conditions.push({ location: { contains: query.location, mode: "insensitive" } });
    if (query.employmentType) conditions.push({ employmentType: { equals: query.employmentType, mode: "insensitive" } });
    if (query.remote === "true") conditions.push({ location: { contains: "remote", mode: "insensitive" } });
    if (query.remote === "false") conditions.push({ NOT: { location: { contains: "remote", mode: "insensitive" } } });
    if (query.source === "recruiter") conditions.push({ source: "RECRUITER" });
    if (query.source === "external") conditions.push({ source: "EXTERNAL" });
    if (query.experience != null) conditions.push({ OR: [{ experienceMin: null }, { experienceMin: { lte: query.experience } }] });
    if (query.salaryMin != null) conditions.push({ OR: [{ salaryMax: null }, { salaryMax: { gte: query.salaryMin } }] });
    if (query.q) {
      conditions.push({
        OR: [
          { title: { contains: query.q, mode: "insensitive" } },
          { description: { contains: query.q, mode: "insensitive" } },
          { company: { name: { contains: query.q, mode: "insensitive" } } },
          { skills: { some: { skill: { name: { contains: query.q, mode: "insensitive" } } } } },
        ],
      });
    }

    const where: any = { status: "PUBLISHED", AND: conditions };
    const orderBy: any =
      query.sort === "oldest" ? { publishedAt: { sort: "asc", nulls: "last" } } :
      query.sort === "salary" ? [{ salaryMax: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }] :
      query.sort === "company" ? { company: { name: "asc" } } :
      { publishedAt: { sort: "desc", nulls: "last" } };

    const [total, jobs, typeFacets, sourceFacets, user] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({ where, include: JOB_CARD_INCLUDE, orderBy, skip: (query.page - 1) * query.limit, take: query.limit, relationLoadStrategy: "join" }),
      prisma.job.groupBy({ by: ["employmentType"], where: { status: "PUBLISHED" }, _count: { _all: true } }),
      prisma.job.groupBy({ by: ["sourceName"], where: { status: "PUBLISHED" }, _count: { _all: true } }),
      optionalUser(request),
    ]);
    const flags = await interactionFlags(user?.sub, jobs.map((job) => job.id));

    return reply.send({
      data: jobs.map((job) => ({
        ...jobCard(job),
        sourceLabel: job.sourceName ?? (job.source === "RECRUITER" ? "Direct listing" : "External"),
        saved: flags.saved.has(job.id),
        applied: flags.applied.has(job.id),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.max(1, Math.ceil(total / query.limit)),
        facets: {
          employmentTypes: typeFacets.filter((entry) => entry.employmentType).map((entry) => ({ value: entry.employmentType!, count: entry._count._all })).sort((a, b) => b.count - a.count),
          sources: sourceFacets.filter((entry) => entry.sourceName).map((entry) => ({ value: entry.sourceName!, count: entry._count._all })).sort((a, b) => b.count - a.count),
        },
        source: "Published recruiter listings and attributed public feeds (Remotive, Arbeitnow, Jobicy)",
      },
    });
  });

  app.get("/jobs/:jobId", { schema: { tags: ["jobs"], summary: "Get a published job with match context" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string().min(1) }).parse(request.params);
    const job = await prisma.job.findFirst({
      where: { id: jobId, status: "PUBLISHED", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { ...JOB_CARD_INCLUDE, _count: { select: { applications: true } } },
      relationLoadStrategy: "join",
    });
    if (!job) return fail(reply, 404, "JOB_NOT_FOUND", "This opportunity is unavailable.");

    const user = await optionalUser(request);
    let saved = false;
    let applicationStatus: string | null = null;
    let profile: any = null;
    let resumeText: string | null = null;
    const isCandidate = Boolean(user?.roles?.includes("CANDIDATE"));
    if (user) {
      const [savedEntry, application, profileData, resume] = await Promise.all([
        prisma.savedJob.findUnique({ where: { userId_jobId: { userId: user.sub, jobId } } }),
        prisma.jobApplication.findUnique({ where: { userId_jobId: { userId: user.sub, jobId } }, select: { status: true } }),
        isCandidate ? prisma.candidateProfile.findUnique({ where: { userId: user.sub }, include: { skills: { include: { skill: true } }, experience: true, education: true } }) : Promise.resolve(null),
        isCandidate ? prisma.resume.findFirst({ where: { userId: user.sub, status: "PROCESSED" }, orderBy: { processedAt: "desc" }, select: { extractedText: true } }) : Promise.resolve(null),
      ]);
      saved = Boolean(savedEntry);
      applicationStatus = application?.status ?? null;
      profile = profileData;
      resumeText = resume?.extractedText ?? null;
      if (job.createdById !== user.sub) await prisma.userInteraction.create({ data: { userId: user.sub, jobId, type: "VIEW" } }).catch(() => undefined);
    }

    let fit: any = null;
    if (profile) {
      const required = job.skills.filter((entry: any) => entry.required).map((entry: any) => entry.skill.normalizedName);
      const preferred = job.skills.filter((entry: any) => !entry.required).map((entry: any) => entry.skill.normalizedName);
      const possessed = new Set<string>(profile.skills.map((entry: any) => String(entry.skill.normalizedName)));
      const overlap = skillOverlap(required, preferred, possessed);
      const experienceScore = experienceCompatibility(profile.experienceYears, job.experienceMin, job.experienceMax);
      const [raw] = tfidfSimilarities(candidateText(profile, resumeText), [jobText(job)]);
      const semanticScore = calibrateSemantic(raw ?? 0);
      const components = { semantic: semanticScore, skills: overlap.score, experience: experienceScore, education: 0.5, preference: 0.5, collaborative: 0 };
      const score = weightedFit(components, { semantic: 0.35, skills: 0.3, experience: 0.2, education: 0.05, preference: 0.1, collaborative: 0 }, { semantic: true, collaborative: false });
      fit = { score, scorePercent: Math.round(score * 100), matchedSkills: displaySkillNames(overlap.matched, job.skills), missingRequiredSkills: displaySkillNames(overlap.missingRequired, job.skills), components, method: "Skills, experience and in-process lexical similarity" };
    }

    const skillNames = job.skills.map((entry) => entry.skill.normalizedName);
    const similarCandidates = await prisma.job.findMany({
      where: {
        id: { not: job.id },
        status: "PUBLISHED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        AND: [{ OR: [{ companyId: job.companyId }, { skills: { some: { skill: { normalizedName: { in: skillNames } } } } }] }],
      },
      include: JOB_CARD_INCLUDE,
      orderBy: { publishedAt: "desc" },
      take: 12,
      relationLoadStrategy: "join",
    });
    const similarJobs = similarCandidates
      .map((candidate) => {
        const shared = candidate.skills.filter((entry) => skillNames.includes(entry.skill.normalizedName)).length;
        return { candidate, shared, sameCompany: candidate.companyId === job.companyId };
      })
      .filter((entry) => entry.sameCompany || entry.shared >= 2)
      .sort((left, right) => Number(right.sameCompany) - Number(left.sameCompany) || right.shared - left.shared)
      .slice(0, 4)
      .map((entry) => entry.candidate);

    return reply.send(wrap({
      ...jobCard(job, { fullDescription: true }),
      sourceLabel: job.sourceName ?? (job.source === "RECRUITER" ? "Direct listing" : "External"),
      saved,
      applied: applicationStatus != null && applicationStatus !== "WITHDRAWN",
      applicationStatus,
      fit,
      similarJobs: similarJobs.map((job) => jobCard(job)),
    }));
  });

  app.post("/jobs/:jobId/save", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["jobs"], summary: "Save a job to the signed-in candidate's list" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const job = await prisma.job.findFirst({ where: { id: jobId, status: "PUBLISHED" } });
    if (!job) return fail(reply, 404, "JOB_NOT_FOUND", "This opportunity is unavailable.");
    await prisma.$transaction([
      prisma.savedJob.upsert({ where: { userId_jobId: { userId: request.user.sub, jobId } }, create: { userId: request.user.sub, jobId }, update: {} }),
      prisma.userInteraction.create({ data: { userId: request.user.sub, jobId, type: "SAVE" } }),
    ]);
    return reply.send(wrap({ saved: true }));
  });

  app.delete("/jobs/:jobId/save", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["jobs"], summary: "Remove a saved job" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    await prisma.savedJob.deleteMany({ where: { userId: request.user.sub, jobId } });
    return reply.send(wrap({ saved: false }));
  });

  app.post("/jobs/:jobId/apply-link", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["jobs"], summary: "Track an outbound application and return the employer's URL" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const job = await prisma.job.findFirst({
      where: { id: jobId, status: "PUBLISHED", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { id: true, applyUrl: true, title: true, source: true, sourceName: true, createdById: true },
    });
    if (!job?.applyUrl) return fail(reply, 404, "APPLY_URL_UNAVAILABLE", "This listing has no external application link.");

    const existing = await prisma.jobApplication.findUnique({ where: { userId_jobId: { userId: request.user.sub, jobId } } });
    let applicationId = existing?.id;
    if (!existing) {
      const created = await prisma.jobApplication.create({ data: { userId: request.user.sub, jobId } }).catch(() => null);
      applicationId = created?.id;
    } else if (existing.status === "WITHDRAWN") {
      await prisma.jobApplication.update({ where: { id: existing.id }, data: { status: "SUBMITTED" } });
    }
    await prisma.userInteraction.create({ data: { userId: request.user.sub, jobId, type: "APPLY" } }).catch(() => undefined);
    if (job.source === "RECRUITER" && job.createdById !== request.user.sub) {
      await notify(job.createdById, "New application", `A candidate applied for ${job.title}.`);
    }
    return reply.send(wrap({ url: job.applyUrl, applied: true, applicationId, trackedAs: "outbound application click" }));
  });

  app.post("/jobs/:jobId/applications", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["jobs"], summary: "Apply to a published job" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const input = z.object({ coverLetter: z.string().max(6000).optional(), resumeId: z.string().optional() }).parse(request.body ?? {});
    const job = await prisma.job.findFirst({ where: { id: jobId, status: "PUBLISHED", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!job) return fail(reply, 404, "JOB_NOT_FOUND", "This opportunity is unavailable.");
    if (input.resumeId) {
      const resume = await prisma.resume.findFirst({ where: { id: input.resumeId, userId: request.user.sub, status: "PROCESSED" } });
      if (!resume) return fail(reply, 400, "RESUME_UNAVAILABLE", "Choose one of your successfully processed resumes.");
    }
    try {
      const application = await prisma.$transaction(async (tx) => {
        const created = await tx.jobApplication.create({ data: { userId: request.user.sub, jobId, coverLetter: input.coverLetter, resumeId: input.resumeId } });
        await tx.userInteraction.create({ data: { userId: request.user.sub, jobId, type: "APPLY" } });
        await tx.notification.create({ data: { userId: job.createdById, title: "New application", message: `A candidate applied for ${job.title}.` } });
        return created;
      }, { timeout: 15000 });
      return reply.code(201).send(wrap(application));
    } catch (error: any) {
      if (error.code === "P2002") return fail(reply, 409, "ALREADY_APPLIED", "You have already applied to this job.");
      throw error;
    }
  });

  app.get("/me/saved-jobs", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["jobs"], summary: "List the signed-in candidate's saved jobs" } }, async (request, reply) => {
    const saved = await prisma.savedJob.findMany({ where: { userId: request.user.sub }, include: { job: { include: JOB_CARD_INCLUDE } }, orderBy: { createdAt: "desc" }, relationLoadStrategy: "join" });
    return reply.send(wrap(saved.map((entry) => ({ ...jobCard(entry.job), savedAt: entry.createdAt, saved: true }))));
  });

  app.get("/me/applications", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["jobs"], summary: "Track the signed-in candidate's applications" } }, async (request, reply) => {
    const applications = await prisma.jobApplication.findMany({
      where: { userId: request.user.sub },
      include: { job: { include: JOB_CARD_INCLUDE }, resume: { select: { id: true, originalName: true } } },
      orderBy: { appliedAt: "desc" },
      relationLoadStrategy: "join",
    });
    return reply.send(wrap(applications.map((application) => ({ ...application, job: jobCard(application.job) }))));
  });

  app.delete("/me/applications/:applicationId", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["jobs"], summary: "Withdraw an application" } }, async (request, reply) => {
    const { applicationId } = z.object({ applicationId: z.string() }).parse(request.params);
    const application = await prisma.jobApplication.findFirst({ where: { id: applicationId, userId: request.user.sub }, include: { job: { select: { title: true } } } });
    if (!application) return fail(reply, 404, "APPLICATION_NOT_FOUND", "Application not found.");
    if (["WITHDRAWN", "REJECTED", "OFFERED"].includes(application.status)) return fail(reply, 400, "APPLICATION_CLOSED", "This application can no longer be withdrawn.");
    const updated = await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "WITHDRAWN" } });
    return reply.send(wrap(updated));
  });
}

async function registerProfiles(app: FastifyInstance) {
  app.get("/me/profile", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["profile"], summary: "Get the candidate profile" } }, async (request, reply) => {
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: request.user.sub }, include: { skills: { include: { skill: true } }, education: true, experience: true, certifications: true } });
    return reply.send(wrap(profile));
  });

  app.put("/me/profile", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["profile"], summary: "Update candidate profile and skill list" } }, async (request, reply) => {
    const resume = await prisma.resume.findFirst({ where: { userId: request.user.sub }, select: { id: true } });
    if (!resume) return fail(reply, 400, "RESUME_REQUIRED", "Upload a resume before saving your candidate profile.");
    const input = z.object({
      headline: z.string().max(180).nullable().optional(), summary: z.string().max(8000).nullable().optional(), location: z.string().trim().min(2, "Location is required").max(180),
      experienceYears: z.number().min(0).max(80).nullable().optional(), currentRole: z.string().trim().min(2, "Current role is required").max(180), careerGoal: z.string().max(180).nullable().optional(),
      preferredLocations: z.array(z.string().max(180)).max(20).optional(), preferredEmployment: z.array(z.string().max(80)).max(10).optional(),
      desiredSalaryMin: z.number().int().nonnegative().nullable().optional(), desiredSalaryMax: z.number().int().nonnegative().nullable().optional(),
      skills: z.array(z.string().trim().min(1).max(100)).min(1, "Add at least one skill").max(100),
      education: z.array(z.object({ institution: z.string().trim().min(1).max(200), degree: z.string().max(160).optional(), field: z.string().max(160).optional(), startDate: z.string().date().optional(), endDate: z.string().date().optional(), description: z.string().max(4000).optional() })).max(30).optional(),
      experience: z.array(z.object({ company: z.string().trim().min(1).max(180), title: z.string().trim().min(1).max(180), location: z.string().max(180).optional(), startDate: z.string().date().optional(), endDate: z.string().date().optional(), current: z.boolean().default(false), description: z.string().max(8000).optional() })).max(50).optional(),
      certifications: z.array(z.object({ name: z.string().trim().min(1).max(180), issuer: z.string().max(180).optional(), issuedAt: z.string().date().optional(), expiresAt: z.string().date().optional(), credentialUrl: httpsUrl(500).optional() })).max(50).optional(),
    }).parse(request.body);
    if (input.desiredSalaryMin != null && input.desiredSalaryMax != null && input.desiredSalaryMin > input.desiredSalaryMax) return fail(reply, 400, "INVALID_SALARY_RANGE", "Minimum salary cannot exceed maximum salary.");
    const { skills, education, experience, certifications, ...fields } = input;
    await prisma.$transaction(async (tx) => {
      const profile = await tx.candidateProfile.upsert({ where: { userId: request.user.sub }, create: { userId: request.user.sub, ...fields }, update: { ...fields, embedding: [] } });
      if (skills) {
        await tx.candidateSkill.deleteMany({ where: { profileId: profile.id } });
        const names = canonicalSkills(skills);
        if (names.length) {
          await tx.skill.createMany({ data: names.map((name) => ({ name, normalizedName: name.toLowerCase() })), skipDuplicates: true });
          const savedSkills = await tx.skill.findMany({ where: { normalizedName: { in: names.map((name) => name.toLowerCase()) } }, select: { id: true } });
          await tx.candidateSkill.createMany({ data: savedSkills.map((skill) => ({ profileId: profile.id, skillId: skill.id })), skipDuplicates: true });
        }
      }
      if (education) {
        await tx.education.deleteMany({ where: { profileId: profile.id } });
        if (education.length) await tx.education.createMany({ data: education.map((item) => ({ profileId: profile.id, institution: item.institution, degree: item.degree, field: item.field, startDate: item.startDate ? new Date(item.startDate) : null, endDate: item.endDate ? new Date(item.endDate) : null, description: item.description })) });
      }
      if (experience) {
        await tx.workExperience.deleteMany({ where: { profileId: profile.id } });
        if (experience.length) await tx.workExperience.createMany({ data: experience.map((item) => ({ profileId: profile.id, company: item.company, title: item.title, location: item.location, startDate: item.startDate ? new Date(item.startDate) : null, endDate: item.endDate ? new Date(item.endDate) : null, current: item.current, description: item.description })) });
      }
      if (certifications) {
        await tx.certification.deleteMany({ where: { profileId: profile.id } });
        if (certifications.length) await tx.certification.createMany({ data: certifications.map((item) => ({ profileId: profile.id, name: item.name, issuer: item.issuer, issuedAt: item.issuedAt ? new Date(item.issuedAt) : null, expiresAt: item.expiresAt ? new Date(item.expiresAt) : null, credentialUrl: item.credentialUrl })) });
      }
    }, { timeout: 15000 });
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: request.user.sub }, include: { skills: { include: { skill: true } }, education: true, experience: true, certifications: true } });
    return reply.send(wrap(profile));
  });
}

async function applyJobSkills(tx: any, jobId: string, skills: { name: string; required: boolean }[]) {
  await tx.jobSkill.deleteMany({ where: { jobId } });
  const seen = new Set<string>();
  for (const item of skills) {
    const name = canonicalSkills([item.name])[0] ?? item.name;
    const normalizedName = name.toLowerCase();
    if (!name || seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const skill = await tx.skill.upsert({ where: { normalizedName }, create: { name, normalizedName }, update: {} });
    await tx.jobSkill.create({ data: { jobId, skillId: skill.id, required: item.required } });
  }
}

async function registerRecruiterRoutes(app: FastifyInstance) {
  app.get("/recruiter/company", { preHandler: requireRole("RECRUITER"), schema: { tags: ["recruiter"], summary: "Get this recruiter's company profile" } }, async (request, reply) => {
    const profile = await prisma.recruiterProfile.findUnique({ where: { userId: request.user.sub }, include: { company: { include: { _count: { select: { jobs: true } } } } } });
    return reply.send(wrap(profile?.company ?? null));
  });

  app.put("/recruiter/company", { preHandler: requireRole("RECRUITER"), schema: { tags: ["recruiter"], summary: "Create or update the recruiter's own company profile" } }, async (request, reply) => {
    const input = z.object({
      name: z.string().trim().min(2).max(180),
      website: httpsUrl(500).optional().or(z.literal("")),
      location: z.string().max(180).optional(),
      description: z.string().max(5000).optional(),
      logoUrl: httpsUrl(1000).optional().or(z.literal("")),
    }).parse(request.body);
    const recruiter = await prisma.recruiterProfile.findUnique({ where: { userId: request.user.sub } });
    if (!recruiter) return fail(reply, 403, "RECRUITER_PROFILE_REQUIRED", "Recruiter profile is unavailable.");
    const data = { name: input.name, website: input.website || null, location: input.location, description: input.description, logoUrl: input.logoUrl || null };
    const company = await prisma.$transaction(async (tx) => {
      if (recruiter.companyId) return tx.company.update({ where: { id: recruiter.companyId }, data });
      const created = await tx.company.create({ data });
      await tx.recruiterProfile.update({ where: { id: recruiter.id }, data: { companyId: created.id } });
      return created;
    }, { timeout: 15000 });
    await prisma.auditLog.create({ data: { actorId: request.user.sub, action: "COMPANY_PROFILE_UPDATED", targetType: "Company", targetId: company.id } });
    return reply.send(wrap(company));
  });

  app.get("/recruiter/stats", { preHandler: requireRole("RECRUITER", "ADMIN"), schema: { tags: ["recruiter"], summary: "Recruiter workspace counters" } }, async (request, reply) => {
    const ownerFilter = request.user.roles.includes("ADMIN") ? {} : { createdById: request.user.sub };
    const jobs = await prisma.job.findMany({ where: ownerFilter, select: { id: true, status: true, createdAt: true } });
    const jobIds = jobs.map((job) => job.id);
    const [applications, recent, byStatus] = await Promise.all([
      prisma.jobApplication.count({ where: { jobId: { in: jobIds } } }),
      prisma.jobApplication.count({ where: { jobId: { in: jobIds }, appliedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
      prisma.jobApplication.groupBy({ by: ["status"], where: { jobId: { in: jobIds } }, _count: { _all: true } }),
    ]);
    return reply.send(wrap({
      jobs: jobs.length,
      published: jobs.filter((job) => job.status === "PUBLISHED").length,
      drafts: jobs.filter((job) => job.status === "DRAFT").length,
      closed: jobs.filter((job) => job.status === "CLOSED" || job.status === "EXPIRED").length,
      applications,
      applicationsThisWeek: recent,
      byStatus: byStatus.map((entry) => ({ status: entry.status, count: entry._count._all })),
    }));
  });

  app.get("/recruiter/jobs", { preHandler: requireRole("RECRUITER", "ADMIN"), schema: { tags: ["recruiter"], summary: "List jobs owned by this recruiter" } }, async (request, reply) => {
    const jobs = await prisma.job.findMany({
      where: request.user.roles.includes("ADMIN") ? {} : { createdById: request.user.sub },
      include: {
        company: { select: { id: true, name: true, logoUrl: true, website: true, location: true } },
        skills: { include: { skill: { select: { id: true, name: true, normalizedName: true } } } },
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: "desc" },
      relationLoadStrategy: "join",
    });
    return reply.send(wrap(jobs.map((job) => jobCard(job, { fullDescription: true }))));
  });

  app.get("/recruiter/jobs/:jobId", { preHandler: requireRole("RECRUITER", "ADMIN"), schema: { tags: ["recruiter"], summary: "Get one owned job listing" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { ...JOB_CARD_INCLUDE, _count: { select: { applications: true } } }, relationLoadStrategy: "join" });
    if (!job) return fail(reply, 404, "JOB_NOT_FOUND", "Job listing not found.");
    if (!request.user.roles.includes("ADMIN") && job.createdById !== request.user.sub) return fail(reply, 403, "FORBIDDEN", "You can only view your own listings.");
    return reply.send(wrap({ ...jobCard(job, { fullDescription: true }), _count: job._count }));
  });

  app.post("/recruiter/jobs", { preHandler: requireRole("RECRUITER"), schema: { tags: ["recruiter"], summary: "Create a recruiter-owned job listing" } }, async (request, reply) => {
    const input = z.object({
      companyName: z.string().trim().min(2).max(180).optional(), companyWebsite: httpsUrl(500).optional().or(z.literal("")), companyLocation: z.string().max(180).optional(), companyLogoUrl: httpsUrl(1000).optional().or(z.literal("")),
      title: z.string().trim().min(3).max(200), description: z.string().trim().min(40).max(30000), location: z.string().trim().min(2).max(200),
      employmentType: z.string().max(80).optional(), experienceMin: z.coerce.number().min(0).max(80).optional(), experienceMax: z.coerce.number().min(0).max(80).optional(),
      salaryMin: z.coerce.number().int().nonnegative().optional(), salaryMax: z.coerce.number().int().nonnegative().optional(), applyUrl: httpsUrl(1000).optional().or(z.literal("")),
      skills: z.array(z.object({ name: z.string().trim().min(1).max(100), required: z.boolean().default(true) })).min(1).max(50),
      status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"), expiresAt: z.string().datetime().optional(),
    }).parse(request.body);
    const recruiter = await prisma.recruiterProfile.findUnique({ where: { userId: request.user.sub } });
    if (!recruiter?.companyId && !input.companyName) return fail(reply, 400, "COMPANY_REQUIRED", "Create a company profile before publishing the first job.");
    const job = await prisma.$transaction(async (tx) => {
      let companyId = recruiter?.companyId;
      if (!companyId) {
        const company = await tx.company.create({ data: { name: input.companyName!, website: input.companyWebsite || null, location: input.companyLocation, logoUrl: input.companyLogoUrl || null } });
        companyId = company.id;
        if (recruiter) await tx.recruiterProfile.update({ where: { id: recruiter.id }, data: { companyId } });
      }
      const created = await tx.job.create({ data: {
        source: "RECRUITER", title: input.title, description: input.description, searchText: input.description.slice(0, 3000), location: input.location, employmentType: input.employmentType,
        experienceMin: input.experienceMin, experienceMax: input.experienceMax, salaryMin: input.salaryMin, salaryMax: input.salaryMax,
        applyUrl: input.applyUrl || null, companyId: companyId!, createdById: request.user.sub, status: input.status,
        publishedAt: input.status === "PUBLISHED" ? new Date() : null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      } });
      await applyJobSkills(tx, created.id, input.skills);
      await tx.auditLog.create({ data: { actorId: request.user.sub, action: "JOB_CREATED", targetType: "Job", targetId: created.id } });
      return tx.job.findUnique({ where: { id: created.id }, include: { ...JOB_CARD_INCLUDE, _count: { select: { applications: true } } } });
    }, { timeout: 20000 });
    return reply.code(201).send(wrap(job ? jobCard(job, { fullDescription: true }) : job));
  });

  app.patch("/recruiter/jobs/:jobId", { preHandler: requireRole("RECRUITER", "ADMIN"), schema: { tags: ["recruiter"], summary: "Edit or change state of an owned job" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const input = z.object({
      title: z.string().trim().min(3).max(200).optional(),
      description: z.string().trim().min(40).max(30000).optional(),
      location: z.string().trim().min(2).max(200).optional(),
      employmentType: z.string().max(80).nullable().optional(),
      experienceMin: z.coerce.number().min(0).max(80).nullable().optional(),
      experienceMax: z.coerce.number().min(0).max(80).nullable().optional(),
      salaryMin: z.coerce.number().int().nonnegative().nullable().optional(),
      salaryMax: z.coerce.number().int().nonnegative().nullable().optional(),
      applyUrl: httpsUrl(1000).nullable().optional().or(z.literal("")),
      status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      skills: z.array(z.object({ name: z.string().trim().min(1).max(100), required: z.boolean().default(true) })).min(1).max(50).optional(),
    }).parse(request.body);
    const existing = await prisma.job.findUnique({ where: { id: jobId } });
    if (!existing) return fail(reply, 404, "JOB_NOT_FOUND", "Job listing not found.");
    if (!request.user.roles.includes("ADMIN") && existing.createdById !== request.user.sub) return fail(reply, 403, "FORBIDDEN", "You can only manage your own listings.");
    const { expiresAt, skills, applyUrl, ...fields } = input;
    const job = await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: {
          ...fields,
          ...(input.description !== undefined ? { searchText: input.description.slice(0, 3000) } : {}),
          ...(applyUrl !== undefined ? { applyUrl: applyUrl || null } : {}),
          embedding: [],
          ...(input.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
          ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
        },
      });
      if (skills) await applyJobSkills(tx, jobId, skills);
      await tx.auditLog.create({ data: { actorId: request.user.sub, action: "JOB_UPDATED", targetType: "Job", targetId: jobId } });
      return tx.job.findUnique({ where: { id: jobId }, include: { ...JOB_CARD_INCLUDE, _count: { select: { applications: true } } } });
    }, { timeout: 20000 });
    return reply.send(wrap(job ? jobCard(job, { fullDescription: true }) : job));
  });

  app.delete("/recruiter/jobs/:jobId", { preHandler: requireRole("RECRUITER", "ADMIN"), schema: { tags: ["recruiter"], summary: "Delete an owned listing with no applications" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { _count: { select: { applications: true } } } });
    if (!job) return fail(reply, 404, "JOB_NOT_FOUND", "Job listing not found.");
    if (!request.user.roles.includes("ADMIN") && job.createdById !== request.user.sub) return fail(reply, 403, "FORBIDDEN", "You can only delete your own listings.");
    if (job._count.applications > 0) return fail(reply, 409, "JOB_HAS_APPLICATIONS", "Close the listing instead of deleting it because it has applications.");
    await prisma.$transaction([prisma.job.delete({ where: { id: jobId } }), prisma.auditLog.create({ data: { actorId: request.user.sub, action: "JOB_DELETED", targetType: "Job", targetId: jobId } })]);
    return reply.send(wrap({ deleted: true }));
  });

  app.get("/recruiter/jobs/:jobId/applications", { preHandler: requireRole("RECRUITER", "ADMIN"), schema: { tags: ["recruiter"], summary: "View applicants only for an owned listing" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return fail(reply, 404, "JOB_NOT_FOUND", "Job listing not found.");
    if (!request.user.roles.includes("ADMIN") && job.createdById !== request.user.sub) return fail(reply, 403, "FORBIDDEN", "You can only view applicants for your listings.");
    const applications = await prisma.jobApplication.findMany({
      where: { jobId },
      include: {
        user: { select: { id: true, name: true, email: true, candidate: { include: { skills: { include: { skill: true } }, experience: true, education: true, certifications: true } } } },
        resume: { select: { id: true, originalName: true, status: true } },
      },
      orderBy: { appliedAt: "desc" },
      relationLoadStrategy: "join",
    });
    return reply.send(wrap(applications));
  });

  app.get("/recruiter/applications/:applicationId/resume", { preHandler: requireRole("RECRUITER", "ADMIN"), schema: { tags: ["recruiter"], summary: "Download an applicant's resume for an owned listing" } }, async (request, reply) => {
    const { applicationId } = z.object({ applicationId: z.string() }).parse(request.params);
    const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { job: true, resume: true } });
    if (!application?.resume) return fail(reply, 404, "RESUME_NOT_FOUND", "No resume was attached to this application.");
    if (!request.user.roles.includes("ADMIN") && application.job.createdById !== request.user.sub) return fail(reply, 403, "FORBIDDEN", "You can only access resumes for your own listings.");
    const opened = await openResume(application.resume.fileKey);
    if (opened.url) return reply.redirect(opened.url);
    return reply.type(application.resume.mimeType).header("Content-Disposition", `attachment; filename="${application.resume.originalName.replace(/[\r\n\"]/g, "_")}"`).send(opened.stream);
  });

  app.get("/recruiter/jobs/:jobId/candidate-matches", { preHandler: requireRole("RECRUITER", "ADMIN"), schema: { tags: ["recruiter"], summary: "Rank applicants with transparent skills, experience, and lexical-fit signals" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: JOB_CARD_INCLUDE, relationLoadStrategy: "join" });
    if (!job) return fail(reply, 404, "JOB_NOT_FOUND", "Job listing not found.");
    if (!request.user.roles.includes("ADMIN") && job.createdById !== request.user.sub) return fail(reply, 403, "FORBIDDEN", "You can only match applicants to your own listing.");
    const applications = await prisma.jobApplication.findMany({
      where: { jobId, status: { not: "WITHDRAWN" } },
      include: {
        user: { select: { id: true, name: true, email: true, candidate: { include: { skills: { include: { skill: true } }, experience: true, education: true } } } },
        resume: { select: { extractedText: true } },
      },
      relationLoadStrategy: "join",
    });

    const jobDescription = jobText(job);
    const candidateTexts = applications.map((application) => candidateText(application.user.candidate, application.resume?.extractedText));
    const similarities = tfidfSimilarities(jobDescription, candidateTexts);
    const requiredSkills = job.skills.filter((entry: any) => entry.required).map((entry: any) => entry.skill.normalizedName);
    const preferredSkills = job.skills.filter((entry: any) => !entry.required).map((entry: any) => entry.skill.normalizedName);

    const matches = applications.map((application, index) => {
      const profile = application.user.candidate;
      const possessed = new Set(profile?.skills.map((entry) => entry.skill.normalizedName) ?? []);
      const overlap = skillOverlap(requiredSkills, preferredSkills, possessed);
      const experienceScore = experienceCompatibility(profile?.experienceYears, job.experienceMin, job.experienceMax);
      const semanticScore = calibrateSemantic(similarities[index] ?? 0);
      const score = semanticScore * 0.35 + overlap.score * 0.45 + experienceScore * 0.2;
      return {
        applicationId: application.id,
        applicationStatus: application.status,
        appliedAt: application.appliedAt,
        candidate: {
          id: application.user.id,
          name: application.user.name,
          email: application.user.email,
          currentRole: profile?.currentRole,
          location: profile?.location,
          experienceYears: profile?.experienceYears,
          skills: (profile?.skills ?? []).map((entry: any) => entry.skill.name),
          resumeId: application.resume ? application.id : null,
        },
        score,
        scorePercent: Math.round(score * 100),
        matchedSkills: displaySkillNames(overlap.matched, job.skills),
        missingRequiredSkills: displaySkillNames(overlap.missingRequired, job.skills),
        components: { semantic: semanticScore, skills: overlap.score, experience: experienceScore },
      };
    }).sort((a, b) => b.score - a.score);

    return reply.send(wrap({ candidates: matches, method: "Applicant-only ranking using required skills, experience, and in-process lexical similarity. No demographic attributes are used." }));
  });

  app.patch("/recruiter/applications/:applicationId", { preHandler: requireRole("RECRUITER", "ADMIN"), schema: { tags: ["recruiter"], summary: "Update an application status on a job you own" } }, async (request, reply) => {
    const { applicationId } = z.object({ applicationId: z.string() }).parse(request.params);
    const { status } = z.object({ status: z.enum(["SUBMITTED", "IN_REVIEW", "SHORTLISTED", "INTERVIEW", "REJECTED", "OFFERED"]) }).parse(request.body);
    const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { job: true } });
    if (!application) return fail(reply, 404, "APPLICATION_NOT_FOUND", "Application not found.");
    if (!request.user.roles.includes("ADMIN") && application.job.createdById !== request.user.sub) return fail(reply, 403, "FORBIDDEN", "You can only update applications to your listings.");
    const updated = await prisma.jobApplication.update({ where: { id: applicationId }, data: { status } });
    await notify(application.userId, "Application update", `Your application for ${application.job.title} is now ${status.toLowerCase().replace(/_/g, " ")}.`);
    return reply.send(wrap(updated));
  });
}

const recommendationCache = new Map<string, { expires: number; payload: any }>();

async function registerRecommendations(app: FastifyInstance) {
  app.get("/recommendations/jobs", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["recommendations"], summary: "Rank current jobs against candidate skills, experience, preferences, and in-process lexical similarity" } }, async (request, reply) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(60).default(40) }).parse(request.query);
    const cacheKey = `${request.user.sub}:${limit}`;
    const cached = recommendationCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return reply.send(wrap(cached.payload));

    const userId = request.user.sub;
    const [profile, dismissed, latestResume, interactions, otherHistory, fetchedJobs] = await Promise.all([
      prisma.candidateProfile.findUnique({ where: { userId }, include: { skills: { include: { skill: true } }, experience: true, education: true, certifications: true }, relationLoadStrategy: "join" }),
      prisma.userInteraction.findMany({ where: { userId, type: "DISMISS" }, select: { jobId: true } }),
      prisma.resume.findFirst({ where: { userId, status: "PROCESSED" }, orderBy: { processedAt: "desc" }, select: { extractedText: true } }),
      prisma.userInteraction.findMany({ where: { userId }, select: { jobId: true, type: true } }),
      prisma.userInteraction.findMany({ where: { userId: { not: userId } }, select: { userId: true, jobId: true, type: true }, orderBy: { createdAt: "desc" }, take: 3000 }),
      prisma.job.findMany({
        where: { status: "PUBLISHED", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: JOB_RANK_SELECT,
        orderBy: { publishedAt: "desc" },
        take: 120,
        relationLoadStrategy: "join",
      }),
    ]);
    if (!profile) return reply.send(wrap({ recommendations: [], notice: "Complete your candidate profile to get matched jobs." }));
    const dismissedIds = new Set(dismissed.map((event) => event.jobId));
    const jobs = fetchedJobs.filter((job) => !dismissedIds.has(job.id));
    if (!jobs.length) return reply.send(wrap({ recommendations: [], notice: "No published opportunities are available yet. Check back soon.", method: "empty", semanticAvailable: false }));

    const candidateSkills = new Set(profile.skills.map((entry) => entry.skill.normalizedName));
    const candidateDescription = candidateText(profile, latestResume?.extractedText);
    const similarities = tfidfSimilarities(candidateDescription, jobs.map(jobText));
    const semantic = similarities.map(calibrateSemantic);
    const semanticAvailable = candidateDescription.trim().length > 0 && semantic.some((value) => value > 0);
    const ownJobIds = new Set(interactions.map((item) => item.jobId));
    const histories = new Map<string, typeof otherHistory>();
    for (const event of otherHistory) histories.set(event.userId, [...(histories.get(event.userId) ?? []), event]);
    const neighbors = [...histories.entries()].filter(([, events]) => events.length >= 3).map(([userId, events]) => {
      const theirs = new Set(events.map((item) => item.jobId));
      const union = new Set([...ownJobIds, ...theirs]);
      const similarity = union.size ? [...ownJobIds].filter((jobId) => theirs.has(jobId)).length / union.size : 0;
      return { userId, events, similarity };
    }).filter((entry) => entry.similarity > 0);
    const collabAvailable = neighbors.length >= 5 && interactions.length >= 3;
    const collabSignals = new Map<string, number>();
    for (const neighbor of neighbors) for (const event of neighbor.events) {
      if (event.type !== "SAVE" && event.type !== "APPLY") continue;
      collabSignals.set(event.jobId, (collabSignals.get(event.jobId) ?? 0) + neighbor.similarity);
    }
    const maxCollaborative = Math.max(0, ...collabSignals.values());
    const profileWeight = { semantic: weight("MATCH_WEIGHT_SEMANTIC", 0.35), skills: weight("MATCH_WEIGHT_SKILL", 0.25), experience: weight("MATCH_WEIGHT_EXPERIENCE", 0.15), education: weight("MATCH_WEIGHT_EDUCATION", 0.05), preference: weight("MATCH_WEIGHT_PREFERENCE", 0.15), collaborative: weight("MATCH_WEIGHT_COLLABORATIVE", 0.05) };

    const results = jobs.map((job, index) => {
      const required = job.skills.filter((entry: any) => entry.required).map((entry: any) => entry.skill.normalizedName);
      const preferred = job.skills.filter((entry: any) => !entry.required).map((entry: any) => entry.skill.normalizedName);
      const overlap = skillOverlap(required, preferred, candidateSkills);
      const matched = overlap.matched;
      const missing = overlap.missingRequired;
      // A single required skill is weak evidence; dampen it so unrelated roles
      // with one generic tag do not outrank genuinely close matches.
      const skillScore = overlap.score * (required.length < 2 ? 0.55 : 1);
      const experienceScore = experienceCompatibility(profile.experienceYears, job.experienceMin, job.experienceMax);
      const educationTerms = profile.education.flatMap((item) => [item.degree, item.field].filter(Boolean).map((value) => value!.toLowerCase()));
      const descriptionForMatch = (job.searchText ?? "").toLowerCase();
      const educationMentionsRequirement = /\b(bachelor|b\.?tech|b\.?e\.?|master|m\.?tech|ph\.?d|diploma|degree)\b/i.test(descriptionForMatch);
      const educationScore = !educationMentionsRequirement || !educationTerms.length ? 0.5 : educationTerms.some((term) => descriptionForMatch.includes(term)) ? 1 : 0.35;
      const targetLocations = [...profile.preferredLocations, profile.location ?? ""].filter(Boolean);
      const locationMatch = !targetLocations.length ? 0.5 : targetLocations.some((location) => job.location.toLowerCase().includes(location.toLowerCase())) ? 1 : /remote/i.test(job.location) ? 0.75 : 0;
      const typeMatch = !profile.preferredEmployment.length || profile.preferredEmployment.some((type) => type.toLowerCase() === (job.employmentType ?? "").toLowerCase()) ? 1 : 0;
      const salaryMatch = !profile.desiredSalaryMin && !profile.desiredSalaryMax || !job.salaryMin && !job.salaryMax ? 0.5 : (job.salaryMax ?? job.salaryMin ?? 0) >= (profile.desiredSalaryMin ?? 0) && (job.salaryMin ?? 0) <= (profile.desiredSalaryMax ?? Number.MAX_SAFE_INTEGER) ? 1 : 0;
      const preferenceScore = (locationMatch + typeMatch + salaryMatch) / 3;
      const sem = Math.max(0, Math.min(1, semantic[index] ?? 0));
      const collab = collabAvailable && maxCollaborative > 0 ? (collabSignals.get(job.id) ?? 0) / maxCollaborative : 0;
      const baseScore = weightedFit({ semantic: sem, skills: skillScore, experience: experienceScore, education: educationScore, preference: preferenceScore, collaborative: collab }, profileWeight, { semantic: semanticAvailable, collaborative: collabAvailable });
      const score = sem < 0.15 && matched.length < 2 ? baseScore * 0.65 : baseScore;
      const reasons = [
        { factor: "skills", score: skillScore, matchedSkills: matched, missingRequiredSkills: missing },
        { factor: "experience", score: experienceScore, candidateYears: profile.experienceYears, requiredMin: job.experienceMin, requiredMax: job.experienceMax },
        { factor: "education", score: educationScore, matched: educationScore === 1 },
        { factor: "location", score: locationMatch, matched: locationMatch === 1 },
        { factor: "employmentPreference", score: typeMatch, matched: typeMatch === 1 },
        { factor: "salaryPreference", score: salaryMatch, matched: salaryMatch === 1 },
        { factor: "semantic", score: sem, model: "In-process TF-IDF cosine similarity" },
      ];
      return { ...jobCard(job), score, scorePercent: Math.round(score * 100), components: { semantic: sem, skills: skillScore, experience: experienceScore, education: educationScore, preference: preferenceScore, collaborative: collab }, reasons, matchedSkills: matched, missingRequiredSkills: missing, sourceLabel: job.sourceName ?? (job.source === "RECRUITER" ? "Direct listing" : "External") };
    }).sort((a, b) => b.score - a.score);

    // Drop listings with almost no lexical overlap and only one matching skill;
    // these are usually unrelated roles that carry a single generic tag.
    const relevant = results.filter((job) => job.components.semantic >= 0.22 || job.matchedSkills.length >= 2);
    const pool = relevant.length ? relevant : results;
    const picked: typeof results = [];
    const companyCounts = new Map<string, number>();
    for (const job of pool) { if ((companyCounts.get(job.companyId) ?? 0) < 2) { picked.push(job); companyCounts.set(job.companyId, (companyCounts.get(job.companyId) ?? 0) + 1); } }
    for (const job of pool) if (picked.length < limit && !picked.includes(job)) picked.push(job);

    if (picked.length) {
      const generatedAt = new Date().toISOString();
      const rows = picked.slice(0, limit).map((job) => ({
        id: randomUUID(), jobId: job.id, score: job.score,
        semanticScore: job.components.semantic, skillScore: job.components.skills, experienceScore: job.components.experience,
        educationScore: job.components.education, preferenceScore: job.components.preference, collaborativeScore: job.components.collaborative,
        reasonData: JSON.stringify(job.reasons), generatedAt,
      }));
      // Single round trip instead of one upsert per recommendation.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Recommendation" ("id","userId","jobId","score","semanticScore","skillScore","experienceScore","educationScore","preferenceScore","collaborativeScore","reasonData","generatedAt")
         SELECT x."id", $1, x."jobId", x."score", x."semanticScore", x."skillScore", x."experienceScore", x."educationScore", x."preferenceScore", x."collaborativeScore", x."reasonData"::jsonb, x."generatedAt"::timestamptz
         FROM jsonb_to_recordset($2::jsonb) AS x("id" text, "jobId" text, "score" float8, "semanticScore" float8, "skillScore" float8, "experienceScore" float8, "educationScore" float8, "preferenceScore" float8, "collaborativeScore" float8, "reasonData" text, "generatedAt" text)
         ON CONFLICT ("userId","jobId") DO UPDATE SET "score"=EXCLUDED."score","semanticScore"=EXCLUDED."semanticScore","skillScore"=EXCLUDED."skillScore","experienceScore"=EXCLUDED."experienceScore","educationScore"=EXCLUDED."educationScore","preferenceScore"=EXCLUDED."preferenceScore","collaborativeScore"=EXCLUDED."collaborativeScore","reasonData"=EXCLUDED."reasonData","generatedAt"=EXCLUDED."generatedAt"`,
        request.user.sub, JSON.stringify(rows),
      ).catch(() => undefined);
    }

    const method = "hybrid-content-and-lexical-semantic";
    const payload = {
      recommendations: picked.slice(0, limit).map((job) => ({ ...job, method })),
      method,
      collaborativeAvailable: collabAvailable,
      semanticAvailable,
      scoreMeaning: "Relative profile-to-listing fit; not a probability of being hired.",
      diversity: { uniqueCompanies: new Set(picked.slice(0, 10).map((job) => job.companyId)).size, topTen: Math.min(10, picked.length) },
      weights: profileWeight,
    };
    if (recommendationCache.size > 500) recommendationCache.clear();
    recommendationCache.set(cacheKey, { expires: Date.now() + 60_000, payload });
    return reply.send(wrap(payload));
  });

  app.post("/recommendations/interactions", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["recommendations"], summary: "Record dismiss feedback for a real listing" } }, async (request, reply) => {
    const input = z.object({ jobId: z.string(), type: z.enum(["DISMISS"]) }).parse(request.body);
    const job = await prisma.job.findFirst({ where: { id: input.jobId, status: "PUBLISHED" } });
    if (!job) return fail(reply, 404, "JOB_NOT_FOUND", "This opportunity is unavailable.");
    await prisma.userInteraction.create({ data: { userId: request.user.sub, jobId: job.id, type: input.type } });
    return reply.code(201).send(wrap({ recorded: true }));
  });

  app.get("/career-paths/suggestions", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["recommendations"], summary: "Suggest a transparent role path using the curated transition graph" } }, async (request, reply) => {
    const { target } = z.object({ target: z.string().trim().min(2).max(180).optional() }).parse(request.query);
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: request.user.sub }, include: { skills: { include: { skill: true } } } });
    if (!profile) return reply.send(wrap({ paths: [], notice: "Complete your profile first." }));
    const goal = target ?? profile.careerGoal ?? "";
    const skillSet = new Set(profile.skills.map((entry) => entry.skill.normalizedName));
    const matchedPaths = matchingCareerTransitions(profile.currentRole ?? "", goal);
    const paths = matchedPaths.map((path) => ({ ...path, matchedSkills: path.skills.filter((skill) => skillSet.has(skill)), missingSkills: path.skills.filter((skill) => !skillSet.has(skill)), evidence: "Curated role-transition rules; not a trained career prediction model." }));
    return reply.send(wrap({ currentRole: profile.currentRole, targetRole: target ?? profile.careerGoal, paths, dataset: "Small documented internal role-transition graph", notice: paths.length ? undefined : "No transition rule matches this role and goal yet. Update your current role or goal to explore supported paths." }));
  });

  app.get("/career-paths", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["recommendations"], summary: "List saved career paths" } }, async (request, reply) => {
    const paths = await prisma.careerPath.findMany({ where: { userId: request.user.sub }, include: { steps: { include: { skills: { include: { skill: true } } }, orderBy: { position: "asc" } } }, orderBy: { updatedAt: "desc" }, relationLoadStrategy: "join" });
    return reply.send(wrap(paths));
  });

  app.post("/career-paths", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["recommendations"], summary: "Save a supported role transition" } }, async (request, reply) => {
    const { targetRole } = z.object({ targetRole: z.string().trim().min(2).max(180) }).parse(request.body);
    const profile = await prisma.candidateProfile.findUnique({ where: { userId: request.user.sub }, include: { skills: { include: { skill: true } } } });
    if (!profile) return fail(reply, 400, "PROFILE_REQUIRED", "Complete your profile first.");
    const rule = matchingCareerTransitions(profile.currentRole ?? "", targetRole)[0];
    if (!rule) return fail(reply, 422, "TRANSITION_UNAVAILABLE", "No documented transition rule matches your current role and target.");
    const existingSkills = new Set(profile.skills.map((entry) => entry.skill.normalizedName));
    const displayRole = targetRole.trim();
    const existingPath = await prisma.careerPath.findFirst({
      where: { userId: request.user.sub, targetRole: { equals: displayRole, mode: "insensitive" } },
      include: { steps: { include: { skills: { include: { skill: true } } }, orderBy: { position: "asc" } } },
      relationLoadStrategy: "join",
    });
    if (existingPath) {
      return reply.send(wrap({ ...existingPath, existingSkills: rule.skills.filter((skill) => existingSkills.has(skill)), missingSkills: rule.skills.filter((skill) => !existingSkills.has(skill)), alreadySaved: true, method: "Curated internal rules; not a trained model" }));
    }
    const skillRecords = await Promise.all(
      canonicalSkills(rule.skills).map((name) => prisma.skill.upsert({ where: { normalizedName: name.toLowerCase() }, create: { name, normalizedName: name.toLowerCase() }, update: {} })),
    );
    const created = await prisma.$transaction(async (tx) => {
      const path = await tx.careerPath.create({ data: { userId: request.user.sub, currentRole: profile.currentRole, targetRole: displayRole } });
      const step = await tx.careerPathStep.create({ data: { careerPathId: path.id, position: 1, roleTitle: displayRole, explanation: rule.explanation } });
      if (skillRecords.length) {
        await tx.careerPathSkill.createMany({ data: skillRecords.map((skill) => ({ stepId: step.id, skillId: skill.id })), skipDuplicates: true });
      }
      return path;
    }, { timeout: 15000 });
    const saved = await prisma.careerPath.findUnique({
      where: { id: created.id },
      include: { steps: { include: { skills: { include: { skill: true } } }, orderBy: { position: "asc" } } },
      relationLoadStrategy: "join",
    });
    await prisma.auditLog.create({ data: { actorId: request.user.sub, action: "CAREER_PATH_SAVED", targetType: "CareerPath", targetId: created.id } });
    return reply.code(201).send(wrap({ ...saved, existingSkills: rule.skills.filter((skill) => existingSkills.has(skill)), missingSkills: rule.skills.filter((skill) => !existingSkills.has(skill)), method: "Curated internal rules; not a trained model" }));
  });
}

async function registerResumeRoutes(app: FastifyInstance) {
  async function processStoredResume(resume: { id: string; userId: string; fileKey: string; originalName: string; mimeType: string }) {
    await prisma.resume.update({ where: { id: resume.id }, data: { status: "PROCESSING", processingError: null } });
    try {
      const bytes = await loadResume(resume.fileKey);
      const extension = resume.fileKey.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
      const parsed = await parseResumeBuffer(bytes, resume.originalName, resume.mimeType, extension);
      await prisma.$transaction(async (tx) => {
        const profile = await tx.candidateProfile.upsert({ where: { userId: resume.userId }, create: { userId: resume.userId }, update: { embedding: [] } });
        const names = canonicalSkills(parsed.parsed.skills ?? []);
        if (names.length) {
          await tx.skill.createMany({ data: names.map((name) => ({ name, normalizedName: name.toLowerCase() })), skipDuplicates: true });
          const skills = await tx.skill.findMany({ where: { normalizedName: { in: names.map((name) => name.toLowerCase()) } }, select: { id: true } });
          await tx.candidateSkill.createMany({ data: skills.map((skill) => ({ profileId: profile.id, skillId: skill.id })), skipDuplicates: true });
        }
        const profileUpdates: any = {};
        if (profile.experienceYears == null && parsed.parsed.experienceYears != null) profileUpdates.experienceYears = parsed.parsed.experienceYears;
        if (!profile.currentRole && parsed.parsed.jobTitles?.[0]) profileUpdates.currentRole = parsed.parsed.jobTitles[0].slice(0, 180);
        if (Object.keys(profileUpdates).length) await tx.candidateProfile.update({ where: { id: profile.id }, data: profileUpdates });
        await tx.resume.update({ where: { id: resume.id }, data: { status: "PROCESSED", extractedText: parsed.text, parsedData: parsed.parsed as any, embedding: parsed.embedding ?? [], processingError: null, processedAt: new Date() } });
      }, { timeout: 20000 });
      return true;
    } catch (error: any) {
      await prisma.resume.update({ where: { id: resume.id }, data: { status: "FAILED", processingError: String(error.message ?? "Resume processing failed").slice(0, 2000) } });
      return false;
    }
  }

  app.get("/me/resumes", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["profile"], summary: "List this candidate's private resumes" } }, async (request, reply) => {
    const resumes = await prisma.resume.findMany({ where: { userId: request.user.sub }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, status: true, processingError: true, parsedData: true, createdAt: true, processedAt: true }, orderBy: { createdAt: "desc" } });
    return reply.send(wrap(resumes));
  });

  app.post("/me/resumes", { preHandler: requireRole("CANDIDATE"), config: { rateLimit: { max: 5, timeWindow: "1 hour" } }, schema: { tags: ["profile"], summary: "Upload and parse a PDF or DOCX resume" } }, async (request, reply) => {
    const part = await request.file();
    if (!part) return fail(reply, 400, "FILE_REQUIRED", "Choose a PDF or DOCX resume.");
    const extension = part.filename.toLowerCase().split(".").pop();
    const expectedMime = extension === "pdf" ? "application/pdf" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "";
    if (!expectedMime || (part.mimetype !== expectedMime && part.mimetype !== "application/octet-stream")) return fail(reply, 415, "UNSUPPORTED_FILE", "Only valid PDF and DOCX resumes are accepted.");
    const bytes = await part.toBuffer();
    if (bytes.length < 8 || bytes.length > 5 * 1024 * 1024) return fail(reply, 413, "INVALID_FILE_SIZE", "Resume files must be between 8 bytes and 5 MB.");
    if (extension === "pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) return fail(reply, 415, "INVALID_PDF", "The file content does not match a PDF.");
    if (extension === "docx" && !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return fail(reply, 415, "INVALID_DOCX", "The file content does not match a DOCX document.");
    const fileKey = await storeResume(bytes, extension as "pdf" | "docx");
    let resume;
    try {
      resume = await prisma.resume.create({ data: { userId: request.user.sub, fileKey, originalName: part.filename.slice(0, 255), mimeType: expectedMime, sizeBytes: bytes.length, status: "QUEUED" } });
    } catch (error) { await deleteResumeFile(fileKey); throw error; }
    const processed = await processStoredResume(resume);
    const saved = await prisma.resume.findUnique({ where: { id: resume.id }, select: { id: true, originalName: true, status: true, parsedData: true, processingError: true } });
    return reply.code(processed ? 201 : 202).send(wrap(saved));
  });

  app.post("/me/resumes/:resumeId/reprocess", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["profile"], summary: "Retry failed resume extraction" } }, async (request, reply) => {
    const { resumeId } = z.object({ resumeId: z.string() }).parse(request.params);
    const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId: request.user.sub } });
    if (!resume) return fail(reply, 404, "RESUME_NOT_FOUND", "Resume not found.");
    const processed = await processStoredResume(resume);
    const saved = await prisma.resume.findUnique({ where: { id: resume.id }, select: { id: true, originalName: true, status: true, parsedData: true, processingError: true } });
    return reply.code(processed ? 200 : 202).send(wrap(saved));
  });

  app.get("/me/resumes/:resumeId/parsed", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["profile"], summary: "Review extracted resume fields" } }, async (request, reply) => {
    const { resumeId } = z.object({ resumeId: z.string() }).parse(request.params);
    const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId: request.user.sub }, select: { id: true, originalName: true, status: true, parsedData: true, extractedText: true, processingError: true } });
    if (!resume) return fail(reply, 404, "RESUME_NOT_FOUND", "Resume not found.");
    return reply.send(wrap(resume));
  });

  app.put("/me/resumes/:resumeId/parsed", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["profile"], summary: "Correct extracted resume fields and update the candidate profile" } }, async (request, reply) => {
    const { resumeId } = z.object({ resumeId: z.string() }).parse(request.params);
    const input = z.object({ name: z.string().trim().min(2).max(160).optional(), email: z.string().email().nullable().optional(), phone: z.string().max(80).nullable().optional(), location: z.string().max(180).nullable().optional(), summary: z.string().max(8000).nullable().optional(), experienceYears: z.number().min(0).max(80).nullable().optional(), skills: z.array(z.string().trim().min(1).max(100)).max(100).optional(), education: z.array(z.string().max(500)).max(30).optional(), jobTitles: z.array(z.string().max(300)).max(30).optional(), certifications: z.array(z.string().max(300)).max(30).optional(), projects: z.array(z.string().max(1000)).max(50).optional() }).parse(request.body);
    const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId: request.user.sub, status: "PROCESSED" } });
    if (!resume) return fail(reply, 404, "RESUME_NOT_FOUND", "Processed resume not found.");
    const previous = (resume.parsedData ?? {}) as Record<string, unknown>;
    const parsedData = { ...previous, ...input };
    await prisma.$transaction(async (tx) => {
      await tx.resume.update({ where: { id: resume.id }, data: { parsedData: parsedData as any } });
      const profile = await tx.candidateProfile.upsert({
        where: { userId: request.user.sub },
        create: {
          userId: request.user.sub,
          ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
          ...(input.jobTitles?.[0] ? { currentRole: input.jobTitles[0].slice(0, 180) } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
        },
        update: {
          ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
          ...(input.jobTitles?.[0] ? { currentRole: input.jobTitles[0].slice(0, 180) } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          embedding: [],
        },
      });
      if (input.skills) {
        await tx.candidateSkill.deleteMany({ where: { profileId: profile.id } });
        const names = canonicalSkills(input.skills);
        if (names.length) {
          await tx.skill.createMany({ data: names.map((name) => ({ name, normalizedName: name.toLowerCase() })), skipDuplicates: true });
          const skills = await tx.skill.findMany({ where: { normalizedName: { in: names.map((name) => name.toLowerCase()) } }, select: { id: true } });
          await tx.candidateSkill.createMany({ data: skills.map((skill) => ({ profileId: profile.id, skillId: skill.id })), skipDuplicates: true });
        }
      }
      if (input.education) {
        await tx.education.deleteMany({ where: { profileId: profile.id } });
        if (input.education.length) await tx.education.createMany({ data: input.education.map((institution) => ({ profileId: profile.id, institution })) });
      }
      if (input.certifications) {
        await tx.certification.deleteMany({ where: { profileId: profile.id } });
        if (input.certifications.length) await tx.certification.createMany({ data: input.certifications.map((name) => ({ profileId: profile.id, name })) });
      }
      if (input.name) await tx.user.update({ where: { id: request.user.sub }, data: { name: input.name } });
      await tx.auditLog.create({ data: { actorId: request.user.sub, action: "RESUME_FIELDS_REVIEWED", targetType: "Resume", targetId: resume.id } });
    }, { timeout: 20000 });
    return reply.send(wrap({ saved: true, parsedData }));
  });

  app.get("/me/resumes/:resumeId/download", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["profile"], summary: "Download the signed-in candidate's private resume" } }, async (request, reply) => {
    const { resumeId } = z.object({ resumeId: z.string() }).parse(request.params);
    const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId: request.user.sub } });
    if (!resume) return fail(reply, 404, "RESUME_NOT_FOUND", "Resume not found.");
    const opened = await openResume(resume.fileKey);
    if (opened.url) return reply.redirect(opened.url);
    return reply.type(resume.mimeType).header("Content-Disposition", `attachment; filename="${resume.originalName.replace(/[\r\n\"]/g, "_")}"`).send(opened.stream);
  });

  app.delete("/me/resumes/:resumeId", { preHandler: requireRole("CANDIDATE"), schema: { tags: ["profile"], summary: "Delete one of the candidate's resumes" } }, async (request, reply) => {
    const { resumeId } = z.object({ resumeId: z.string() }).parse(request.params);
    const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId: request.user.sub } });
    if (!resume) return fail(reply, 404, "RESUME_NOT_FOUND", "Resume not found.");
    await prisma.$transaction([prisma.jobApplication.updateMany({ where: { resumeId }, data: { resumeId: null } }), prisma.resume.delete({ where: { id: resumeId } })]);
    await deleteResumeFile(resume.fileKey);
    return reply.send(wrap({ deleted: true }));
  });
}

async function registerNotifications(app: FastifyInstance) {
  app.get("/me/notifications", { preHandler: authenticate, schema: { tags: ["notifications"], summary: "List the signed-in account's notifications" } }, async (request, reply) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: request.user.sub }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.notification.count({ where: { userId: request.user.sub, readAt: null } }),
    ]);
    return reply.send(wrap({ items, unread }));
  });

  app.patch("/me/notifications/:notificationId/read", { preHandler: authenticate, schema: { tags: ["notifications"], summary: "Mark one notification as read" } }, async (request, reply) => {
    const { notificationId } = z.object({ notificationId: z.string() }).parse(request.params);
    const result = await prisma.notification.updateMany({ where: { id: notificationId, userId: request.user.sub }, data: { readAt: new Date() } });
    if (!result.count) return fail(reply, 404, "NOTIFICATION_NOT_FOUND", "Notification not found.");
    return reply.send(wrap({ read: true }));
  });

  app.post("/me/notifications/read-all", { preHandler: authenticate, schema: { tags: ["notifications"], summary: "Mark all notifications as read" } }, async (request, reply) => {
    const result = await prisma.notification.updateMany({ where: { userId: request.user.sub, readAt: null }, data: { readAt: new Date() } });
    return reply.send(wrap({ marked: result.count }));
  });

  app.delete("/me/notifications/:notificationId", { preHandler: authenticate, schema: { tags: ["notifications"], summary: "Delete a notification" } }, async (request, reply) => {
    const { notificationId } = z.object({ notificationId: z.string() }).parse(request.params);
    await prisma.notification.deleteMany({ where: { id: notificationId, userId: request.user.sub } });
    return reply.send(wrap({ deleted: true }));
  });

  app.get("/me/overview", { preHandler: authenticate, schema: { tags: ["profile"], summary: "Role-aware workspace counters and profile completeness" } }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub }, include: { roles: true } });
    if (!user) return fail(reply, 401, "UNAUTHENTICATED", "Sign in to continue.");
    const roles = userRoles(user);
    const result: any = { unreadNotifications: await prisma.notification.count({ where: { userId: user.id, readAt: null } }) };

    if (roles.includes("CANDIDATE")) {
      const [profile, savedJobs, applications, activeApplications, resumes, recommendationCount] = await Promise.all([
        prisma.candidateProfile.findUnique({ where: { userId: user.id }, include: { skills: true } }),
        prisma.savedJob.count({ where: { userId: user.id } }),
        prisma.jobApplication.count({ where: { userId: user.id } }),
        prisma.jobApplication.count({ where: { userId: user.id, status: { notIn: ["WITHDRAWN", "REJECTED"] } } }),
        prisma.resume.count({ where: { userId: user.id } }),
        prisma.recommendation.count({ where: { userId: user.id } }),
      ]);
      const checks = [Boolean(profile?.currentRole), Boolean(profile?.location), Boolean(profile?.headline || profile?.summary), profile?.experienceYears != null, Boolean(profile?.skills.length), resumes > 0];
      result.candidate = {
        savedJobs,
        applications,
        activeApplications,
        resumes,
        recommendationCount,
        profileComplete: Math.round((checks.filter(Boolean).length / checks.length) * 100),
        hasProfile: Boolean(profile),
        currentRole: profile?.currentRole ?? null,
        skills: profile?.skills.length ?? 0,
      };
    }

    if (roles.includes("RECRUITER") || roles.includes("ADMIN")) {
      const jobFilter = roles.includes("ADMIN") ? {} : { createdById: user.id };
      const jobs = await prisma.job.findMany({ where: jobFilter, select: { id: true, status: true } });
      const jobIds = jobs.map((job) => job.id);
      const [applications, newApplications] = await Promise.all([
        prisma.jobApplication.count({ where: { jobId: { in: jobIds } } }),
        prisma.jobApplication.count({ where: { jobId: { in: jobIds }, status: "SUBMITTED" } }),
      ]);
      result.recruiter = {
        jobs: jobs.length,
        published: jobs.filter((job) => job.status === "PUBLISHED").length,
        drafts: jobs.filter((job) => job.status === "DRAFT").length,
        applications,
        newApplications,
      };
    }

    return reply.send(wrap(result));
  });
}

async function registerCompanies(app: FastifyInstance) {
  app.get("/companies", { schema: { tags: ["jobs"], summary: "Browse companies with open roles" } }, async (request, reply) => {
    const { q, page, limit } = z.object({ q: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const where: any = { jobs: { some: { status: "PUBLISHED" } } };
    if (q) where.name = { contains: q, mode: "insensitive" };
    const [total, companies] = await prisma.$transaction([
      prisma.company.count({ where }),
      prisma.company.findMany({ where, include: { _count: { select: { jobs: { where: { status: "PUBLISHED" } } } } }, orderBy: { name: "asc" }, skip: (page - 1) * limit, take: limit, relationLoadStrategy: "join" }),
    ]);
    return reply.send({ data: companies, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  });

  app.get("/companies/:companyId", { schema: { tags: ["jobs"], summary: "Company profile with open roles" } }, async (request, reply) => {
    const { companyId } = z.object({ companyId: z.string() }).parse(request.params);
    const company = await prisma.company.findUnique({ where: { id: companyId }, include: { _count: { select: { jobs: true, recruiters: true } } }, relationLoadStrategy: "join" });
    if (!company) return fail(reply, 404, "COMPANY_NOT_FOUND", "This company is not available.");
    const jobs = await prisma.job.findMany({
      where: { companyId, status: "PUBLISHED", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: JOB_CARD_INCLUDE,
      orderBy: { publishedAt: "desc" },
      take: 30,
      relationLoadStrategy: "join",
    });
    return reply.send(wrap({ ...company, openRoles: jobs.length, jobs: jobs.map((job) => jobCard(job)) }));
  });
}

async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/admin/stats", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Read system counts and marketplace health" } }, async (_request, reply) => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [users, candidates, recruiters, admins, companies, jobs, publishedJobs, externalJobs, applications, applicationsToday, applicationsThisWeek, resumes, recommendations] = await Promise.all([
      prisma.user.count(), prisma.userRole.count({ where: { role: "CANDIDATE" } }), prisma.userRole.count({ where: { role: "RECRUITER" } }), prisma.userRole.count({ where: { role: "ADMIN" } }),
      prisma.company.count(), prisma.job.count(), prisma.job.count({ where: { status: "PUBLISHED" } }), prisma.job.count({ where: { source: "EXTERNAL" } }),
      prisma.jobApplication.count(), prisma.jobApplication.count({ where: { appliedAt: { gte: dayAgo } } }), prisma.jobApplication.count({ where: { appliedAt: { gte: weekAgo } } }),
      prisma.resume.count(), prisma.recommendation.count(),
    ]);
    return reply.send(wrap({ users, candidates, recruiters, admins, companies, jobs, publishedJobs, externalJobs, recruiterJobs: jobs - externalJobs, applications, applicationsToday, applicationsThisWeek, resumes, recommendations }));
  });

  app.get("/admin/users", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Search and review accounts" } }, async (request, reply) => {
    const { q, role, status, page, limit } = z.object({
      q: z.string().trim().max(120).optional(),
      role: z.enum(["CANDIDATE", "RECRUITER", "ADMIN"]).optional(),
      status: z.enum(["active", "disabled"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }).parse(request.query);
    const where: any = {};
    if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }];
    if (role) where.roles = { some: { role } };
    if (status === "active") where.disabledAt = null;
    if (status === "disabled") where.disabledAt = { not: null };
    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, emailVerifiedAt: true, disabledAt: true, createdAt: true, roles: true, _count: { select: { applications: true, jobsCreated: true, resumes: true } } },
        orderBy: { createdAt: "desc" },
        relationLoadStrategy: "join",
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return reply.send({ data: users, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  });

  app.get("/admin/jobs", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Review and moderate job listings" } }, async (request, reply) => {
    const { status, source, q, page, limit } = z.object({
      status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "EXPIRED"]).optional(),
      source: z.enum(["RECRUITER", "EXTERNAL"]).optional(),
      q: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }).parse(request.query);
    const where: any = {};
    if (status) where.status = status;
    if (source) where.source = source;
    if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }];
    const [total, jobs] = await prisma.$transaction([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        select: { id: true, title: true, status: true, source: true, sourceName: true, location: true, createdAt: true, publishedAt: true, company: { select: { id: true, name: true } }, createdBy: { select: { id: true, email: true, name: true } }, _count: { select: { applications: true } } },
        orderBy: { createdAt: "desc" },
        relationLoadStrategy: "join",
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return reply.send({ data: jobs, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  });

  app.get("/admin/applications", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Recent applications across the marketplace" } }, async (_request, reply) => {
    const applications = await prisma.jobApplication.findMany({
      include: { user: { select: { id: true, name: true, email: true } }, job: { select: { id: true, title: true, company: { select: { name: true } } } } },
      orderBy: { appliedAt: "desc" },
      take: 50,
    });
    return reply.send(wrap(applications));
  });

  app.get("/admin/companies", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Companies and their listing counts" } }, async (_request, reply) => {
    const companies = await prisma.company.findMany({ include: { _count: { select: { jobs: true, recruiters: true } } }, orderBy: { createdAt: "desc" }, take: 100, relationLoadStrategy: "join" });
    return reply.send(wrap(companies));
  });

  app.get("/admin/audit", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Recent audit log entries" } }, async (_request, reply) => {
    const logs = await prisma.auditLog.findMany({ include: { actor: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 60 });
    return reply.send(wrap(logs));
  });

  app.post("/admin/jobs/sync", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Refresh external listings from the free public job APIs" } }, async (request, reply) => {
    try {
      const result = await syncExternalJobs({ force: true });
      await prisma.auditLog.create({ data: { actorId: request.user.sub, action: "EXTERNAL_JOBS_SYNCED", targetType: "Job", metadata: result as any } });
      return reply.send(wrap(result));
    } catch (error: any) {
      return fail(reply, 502, "JOB_SYNC_FAILED", error?.message ?? "The public job APIs could not be reached.");
    }
  });

  app.get("/admin/recommendation-exposure", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Audit recommendation exposure by company" } }, async (_request, reply) => {
    const recent = await prisma.recommendation.findMany({ where: { generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }, select: { job: { select: { companyId: true, company: { select: { name: true } } } } } });
    const counts = new Map<string, { companyId: string; company: string; exposures: number }>();
    for (const item of recent) {
      const entry = counts.get(item.job.companyId) ?? { companyId: item.job.companyId, company: item.job.company.name, exposures: 0 };
      entry.exposures += 1; counts.set(item.job.companyId, entry);
    }
    const companies = [...counts.values()].sort((a, b) => b.exposures - a.exposures);
    const total = recent.length;
    return reply.send(wrap({ periodDays: 30, totalRecommendationRows: total, uniqueCompanies: companies.length, exposureByCompany: companies, topCompanyExposureShare: total ? companies.slice(0, 1).reduce((sum, item) => sum + item.exposures, 0) / total : 0, note: "Company-level exposure monitoring only. No demographic fairness claim is made because protected-group labels and a validated evaluation set are not available." }));
  });

  app.patch("/admin/jobs/:jobId", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Moderate a listing" } }, async (request, reply) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    const { status } = z.object({ status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "EXPIRED"]) }).parse(request.body);
    const job = await prisma.job.update({ where: { id: jobId }, data: { status, ...(status === "PUBLISHED" ? { publishedAt: new Date() } : {}) } });
    await prisma.auditLog.create({ data: { actorId: request.user.sub, action: "JOB_MODERATED", targetType: "Job", targetId: jobId, metadata: { status } } });
    return reply.send(wrap(job));
  });

  app.patch("/admin/users/:userId/disable", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Disable or re-enable a user and revoke their sessions" } }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string() }).parse(request.params);
    const { disabled } = z.object({ disabled: z.boolean() }).parse(request.body);
    if (request.user.sub === userId && disabled) return fail(reply, 400, "CANNOT_DISABLE_SELF", "You cannot disable your own account.");
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { disabledAt: disabled ? new Date() : null } }),
      ...(disabled ? [prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })] : []),
    ]);
    await prisma.auditLog.create({ data: { actorId: request.user.sub, action: disabled ? "USER_DISABLED" : "USER_ENABLED", targetType: "User", targetId: userId } });
    return reply.send(wrap({ disabled }));
  });

  app.put("/admin/users/:userId/roles/:role", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Grant a role to an account" } }, async (request, reply) => {
    const { userId, role } = z.object({ userId: z.string(), role: z.enum(["CANDIDATE", "RECRUITER", "ADMIN"]) }).parse(request.params);
    await prisma.userRole.upsert({ where: { userId_role: { userId, role } }, create: { userId, role }, update: {} });
    if (role === "RECRUITER") await prisma.recruiterProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    if (role === "CANDIDATE") await prisma.candidateProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    await prisma.auditLog.create({ data: { actorId: request.user.sub, action: "USER_ROLE_GRANTED", targetType: "User", targetId: userId, metadata: { role } } });
    return reply.send(wrap({ granted: role }));
  });

  app.delete("/admin/users/:userId/roles/:role", { preHandler: requireRole("ADMIN"), schema: { tags: ["admin"], summary: "Revoke a role from an account" } }, async (request, reply) => {
    const { userId, role } = z.object({ userId: z.string(), role: z.enum(["CANDIDATE", "RECRUITER", "ADMIN"]) }).parse(request.params);
    if (request.user.sub === userId && role === "ADMIN") return fail(reply, 400, "CANNOT_REVOKE_SELF", "You cannot remove your own admin role.");
    await prisma.userRole.deleteMany({ where: { userId, role } });
    await prisma.auditLog.create({ data: { actorId: request.user.sub, action: "USER_ROLE_REVOKED", targetType: "User", targetId: userId, metadata: { role } } });
    return reply.send(wrap({ revoked: role }));
  });
}
