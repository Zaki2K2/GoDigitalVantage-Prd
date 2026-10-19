import { z } from 'zod';
import { paginationQuery, OBJECT_ID } from '../../shared/pagination';

export const idSchema = z
  .string()
  .regex(OBJECT_ID, 'Invalid ID')
  .transform((value) => value.toLowerCase());
export const listSchema = z
  .object({
    ...paginationQuery,
    search: z.string().trim().max(120).default(''),
    status: z.string().max(40).optional(),
    businessId: idSchema.optional(),
    actorUserId: idSchema.optional(),
    action: z.string().max(80).optional(),
    entity: z.string().max(40).optional(),
    role: z.enum(['USER', 'SUPER_ADMIN', 'owner', 'member']).optional(),
    onboarding: z.enum(['complete', 'incomplete']).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    questionnaireId: idSchema.optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    sort: z
      .enum(['createdAt', 'name', 'fullName', 'submittedAt', 'at', 'updatedAt'])
      .default('createdAt'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'End date must follow start date',
  });
export type ListQuery = z.infer<typeof listSchema>;
