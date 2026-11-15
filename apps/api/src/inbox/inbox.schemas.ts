import { z } from 'zod';

export const listConversationsSchema = z.object({
  /** "active" (padrão) = abertas + pendentes. */
  status: z.enum(['active', 'open', 'pending', 'resolved', 'all']).default('active'),
  /** "any" (padrão), "me", "none" (sem dono) ou o id de um membro. */
  assignee: z.union([z.enum(['any', 'me', 'none']), z.uuid()]).default('any'),
  channel: z.uuid().optional(),
  contact: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const updateConversationSchema = z
  .object({
    status: z.enum(['open', 'pending', 'resolved']).optional(),
    assigneeId: z.uuid().nullable().optional(),
    subject: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar');

export const listMessagesSchema = z.object({
  /** Cursor da página anterior (mensagens mais antigas). */
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    body: z.string().trim().min(1).max(4096),
    replyToId: z.uuid().optional(),
  }),
  z.object({
    type: z.literal('template'),
    template: z.object({
      name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Nome do template: minúsculas, números e _'),
      language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'Idioma no formato pt_BR'),
      parameters: z.array(z.string().trim().min(1).max(1024)).max(10).optional(),
    }),
  }),
]);

export type ListConversationsInput = z.infer<typeof listConversationsSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
