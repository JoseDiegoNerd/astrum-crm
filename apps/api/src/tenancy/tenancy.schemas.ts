import { z } from 'zod';

const name = z.string().trim().min(1).max(120);

export const createTenantSchema = z.object({
  name,
  workspaceName: name.optional(),
});

export const addTenantMemberSchema = z.object({
  email: z.email(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
});

export const updateTenantMemberSchema = z
  .object({
    role: z.enum(['owner', 'admin', 'member']).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .refine((v) => v.role || v.status, 'Informe role ou status');

export const createWorkspaceSchema = z.object({
  name,
  timezone: z.string().optional(),
  locale: z.string().optional(),
});

export const addWorkspaceMemberSchema = z.object({
  userId: z.uuid(),
  role: z.enum(['manager', 'agent', 'viewer']).default('agent'),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type AddTenantMemberInput = z.infer<typeof addTenantMemberSchema>;
export type UpdateTenantMemberInput = z.infer<typeof updateTenantMemberSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type AddWorkspaceMemberInput = z.infer<typeof addWorkspaceMemberSchema>;
