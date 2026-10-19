import { z } from 'zod';
import { idSchema } from '../admin/admin.schemas';
import { paginationQuery } from '../../shared/pagination';
import { INSTANT_REWARD_STATUSES, INSTANT_REWARD_TYPES } from './instant-reward.domain';
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const metadata = z
  .record(
    z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/)
      .refine((k) => !['__proto__', 'constructor', 'prototype'].includes(k)),
    z.union([z.string().max(500), z.number().finite(), z.boolean()]),
  )
  .refine((v) => Object.keys(v).length <= 20)
  .default({});
const fields = {
  recipientUserId: idSchema.nullable().optional(),
  recipientEmail: email.optional(),
  businessId: idSchema.nullable().optional(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  rewardType: z.enum(INSTANT_REWARD_TYPES),
  rewardValue: z.number().finite().positive().max(1_000_000).nullable().optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
  promoCode: z.string().trim().min(1).max(80).nullable().optional(),
  metadata,
  expiresAt: z.iso
    .datetime()
    .transform((v) => new Date(v))
    .refine(
      (v) => v > new Date() && v.getTime() <= Date.now() + 365 * 86400000,
      'Choose a future expiration within 365 days',
    ),
  verificationRequired: z.boolean().default(true),
};
const validTerms = (v: {
  rewardType: string;
  rewardValue?: number | null;
  currency?: string | null;
}) =>
  v.rewardType === 'PERCENT_DISCOUNT'
    ? !!v.rewardValue && v.rewardValue <= 100
    : v.rewardType === 'FIXED_DISCOUNT'
      ? !!v.rewardValue && !!v.currency
      : true;
export const createInstantRewardSchema = z
  .object({ ...fields, createRequestId: z.uuid(), sendImmediately: z.boolean().default(false) })
  .strict()
  .refine((v) => !!v.recipientUserId || !!v.recipientEmail, 'Choose a user or recipient email')
  .refine(validTerms, 'Invalid reward value or currency');
export const editInstantRewardSchema = z
  .object({ ...fields, expectedRevision: z.number().int().positive() })
  .strict()
  .refine((v) => !!v.recipientUserId || !!v.recipientEmail)
  .refine(validTerms, 'Invalid reward value or currency');
export type CreateInstantReward = z.infer<typeof createInstantRewardSchema>;
export const operationSchema = z.object({ requestId: z.uuid(), confirm: z.literal(true) }).strict();
export const adminActionSchema = z
  .object({ confirm: z.literal(true), reason: z.string().trim().max(500).optional() })
  .strict();
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid reward token');
export const tokenBody = z.object({ token: tokenSchema }).strict();
export const claimBody = z
  .object({ token: tokenSchema.optional(), rewardId: idSchema.optional(), requestId: z.uuid() })
  .strict()
  .refine((v) => !!v.token !== !!v.rewardId, 'Provide a token or reward ID');
export const rewardListSchema = z
  .object({
    ...paginationQuery,
    search: z.string().trim().max(120).default(''),
    status: z.enum(INSTANT_REWARD_STATUSES).optional(),
    recipientUserId: idSchema.optional(),
    rewardType: z.enum(INSTANT_REWARD_TYPES).optional(),
    enabled: z.enum(['true', 'false']).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    group: z.enum(['available', 'claimed', 'expired']).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'End date must follow start date');
