import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../plugins/auth.js";
import { errorResponseSchema } from "../schemas/common.js";
import {
  createPostSchema,
  postIdParamsSchema,
  postSchema,
  updatePostSchema,
} from "../schemas/posts.js";

export const postsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get(
    "/posts",
    {
      schema: {
        tags: ["posts"],
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(postSchema), 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { data, error } = await request.userClient
        .from("posts")
        .select("id, user_id, title, content, created_at")
        .order("created_at", { ascending: false });

      if (error) return reply.code(400).send({ error: error.message });

      return data;
    },
  );

  app.post(
    "/posts",
    {
      schema: {
        tags: ["posts"],
        security: [{ bearerAuth: [] }],
        body: createPostSchema,
        response: { 201: postSchema, 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { data, error } = await request.userClient
        .from("posts")
        .insert({ user_id: request.userId, ...request.body })
        .select()
        .single();

      if (error) return reply.code(400).send({ error: error.message });

      return reply.code(201).send(data);
    },
  );

  app.patch(
    "/posts/:id",
    {
      schema: {
        tags: ["posts"],
        security: [{ bearerAuth: [] }],
        params: postIdParamsSchema,
        body: updatePostSchema,
        response: { 200: postSchema, 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { data, error } = await request.userClient
        .from("posts")
        .update(request.body)
        .eq("id", request.params.id)
        .select();

      if (error) return reply.code(400).send({ error: error.message });
      if (data.length === 0) return reply.code(404).send({ error: "Not found." });

      return data[0];
    },
  );

  app.delete(
    "/posts/:id",
    {
      schema: {
        tags: ["posts"],
        security: [{ bearerAuth: [] }],
        params: postIdParamsSchema,
        response: { 204: z.void(), 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { data, error } = await request.userClient
        .from("posts")
        .delete()
        .eq("id", request.params.id)
        .select();

      if (error) return reply.code(400).send({ error: error.message });
      if (data.length === 0) return reply.code(404).send({ error: "Not found." });

      return reply.code(204).send();
    },
  );
};
