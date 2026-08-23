import type { FastifyReply, FastifyRequest } from "fastify";
import { createUserClient } from "../supabase.js";

declare module "fastify" {
  interface FastifyRequest {
    userClient: ReturnType<typeof createUserClient>;
    userId: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    return reply.code(401).send({ error: "Missing Authorization: Bearer <token> header." });
  }

  const userClient = createUserClient(token);
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    return reply.code(401).send({ error: "Invalid or expired token." });
  }

  request.userClient = userClient;
  request.userId = data.user.id;
}
