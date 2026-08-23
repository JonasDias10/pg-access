import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export const authResponseSchema = z.object({
  userId: z.uuid(),
  accessToken: z.string(),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const pendingConfirmationSchema = z.object({ message: z.string() });

export type PendingConfirmation = z.infer<typeof pendingConfirmationSchema>;
