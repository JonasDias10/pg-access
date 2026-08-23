import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  authResponseSchema,
  credentialsSchema,
  pendingConfirmationSchema,
} from "../schemas/auth.js";
import { errorResponseSchema } from "../schemas/common.js";
import { createAnonClient } from "../supabase.js";

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/signup",
    {
      schema: {
        tags: ["auth"],
        body: credentialsSchema,
        response: {
          201: authResponseSchema,
          202: pendingConfirmationSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { data, error } = await createAnonClient().auth.signUp(request.body);

      if (error) return reply.code(400).send({ error: error.message });

      if (!data.session || !data.user) {
        return reply.code(202).send({ message: "Check your email to confirm sign-up." });
      }

      return reply.code(201).send({ userId: data.user.id, accessToken: data.session.access_token });
    },
  );

  app.post(
    "/login",
    {
      schema: {
        tags: ["auth"],
        body: credentialsSchema,
        response: { 200: authResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { data, error } = await createAnonClient().auth.signInWithPassword(request.body);

      if (error || !data.session) {
        return reply.code(401).send({ error: error?.message ?? "Invalid credentials." });
      }

      return reply.send({ userId: data.user.id, accessToken: data.session.access_token });
    },
  );
};
