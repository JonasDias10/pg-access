import { z } from "zod";

export const createPostSchema = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
});

export type CreatePostBody = z.infer<typeof createPostSchema>;

export const updatePostSchema = createPostSchema.partial();

export type UpdatePostBody = z.infer<typeof updatePostSchema>;

export const postIdParamsSchema = z.object({
  id: z.uuid(),
});

export type PostIdParams = z.infer<typeof postIdParamsSchema>;

export const postSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  title: z.string(),
  content: z.string().nullable(),
  created_at: z.string(),
});

export type Post = z.infer<typeof postSchema>;
