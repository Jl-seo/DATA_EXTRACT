import { z } from 'zod';

export const EntraIDUser = z.object({
  id: z.string(),
  displayName: z.string(),
  userPrincipalName: z.string(),
});

export type EntraIDUser = z.infer<typeof EntraIDUser>;

export const EntraIDGroup = z.object({
  id: z.string(),
  displayName: z.string(),
  mail: z.string().nullable(),
  groupTypes: z.array(z.string()).default([]),
  mailEnabled: z.boolean().nullish(),
  securityEnabled: z.boolean().nullish(),
});

export const UserListRequest = z.object({
  pageSize: z.number().default(10),
  skipToken: z.string().default(''),
  search: z.string().nullish().default(''),
});

const GroupType = z.enum(['all', 'M365', 'Security']);
export type GroupType = z.infer<typeof GroupType>;

export const GroupListRequest = UserListRequest.extend({
  groupType: GroupType.default('all'),
})

export type UserListRequest = z.infer<typeof UserListRequest>;
export type UserListRequestInput = z.input<typeof UserListRequest>;

export type GroupListRequest = z.infer<typeof GroupListRequest>;
export type GroupListRequestInput = z.input<typeof GroupListRequest>;

export const GroupMembersListRequest = EntraIDGroup.pick({
  id: true,
});
export type GroupMembersListRequest = z.infer<typeof GroupMembersListRequest>;
