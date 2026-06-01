import { z } from 'zod';

export const UserObject = z.object({
  name: z.string(),
  upn: z.string().optional(),
  object_id: z.string(),
});

export type UserObject = z.infer<typeof UserObject>;
