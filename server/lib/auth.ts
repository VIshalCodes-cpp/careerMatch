import { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./database";

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await request.jwtVerify<{ sub: string; roles: string[] }>();
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { roles: { select: { role: true } } } });
    if (!user || user.disabledAt) throw new Error("Account is unavailable");
    request.user = { sub: user.id, roles: user.roles.map((entry) => entry.role) };
  } catch {
    reply.clearCookie("cm_access", { path: "/" });
    return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request, reply);
    if (reply.sent) return authResult;
    if (!request.user.roles.some((role) => roles.includes(role))) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "This account cannot perform that action." } });
    }
  };
}
