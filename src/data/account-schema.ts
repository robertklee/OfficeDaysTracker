import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, 'Use 3-30 letters, numbers, or underscores for your username.');
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters for your password.')
  .max(200, 'Passwords must be at most 200 characters.');
export const loginSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
  })
  .strict();
export const signupSchema = loginSchema
  .extend({
    displayName: z.string().trim().min(1).max(60),
  })
  .strict();
export const userSchema = z
  .object({
    id: z.string().uuid(),
    username: usernameSchema,
    displayName: z.string().min(1).max(60),
  })
  .strict();
export const sessionSchema = z.object({ user: userSchema.nullable() }).strict();
export type User = z.infer<typeof userSchema>;
