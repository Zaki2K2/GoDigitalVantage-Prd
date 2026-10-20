import { z } from 'zod';
import { paginationQuery } from '../../shared/pagination';
import { DISCOUNT_TYPES, INCIDENT_STATUSES, RULE_MODES } from './reward.model';

const money = z.number().positive().max(1_000_000);

const ruleShape = {
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  maxRating: z.number().int().min(1).max(5).default(2),
  mode: z.enum(RULE_MODES).default('approval'),
  discountType: z.enum(DISCOUNT_TYPES),
  discountValue: money,
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((c) => c.toUpperCase())
    .default('USD'),
  minSpend: money.nullable().default(null),
  maxDiscount: money.nullable().default(null),
  validityDays: z.number().int().min(1).max(365).default(30),
  cooldownDays: z.number().int().min(0).max(365).default(30),
  maxIssuancesTotal: z.number().int().min(1).max(1_000_000).nullable().default(null),
  maxIssuancesPerDay: z.number().int().min(1).max(100_000).nullable().default(null),
  terms: z.string().trim().max(500).default(''),
};

type RuleCheck = {
  discountType?: string;
  discountValue?: number;
  maxDiscount?: number | null;
};
const ruleRefine = (r: RuleCheck, ctx: z.RefinementCtx) => {
  if (r.discountType === 'percent' && r.discountValue !== undefined && r.discountValue > 100) {
    ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Percent must be 1-100' });
  }
  if (r.discountType === 'fixed' && r.maxDiscount != null) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxDiscount'],
      message: 'Maximum discount only applies to percentage rewards',
    });
  }
};

export const createRuleSchema = z.object(ruleShape).strict().superRefine(ruleRefine);
export const updateRuleSchema = z
  .object(ruleShape)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .superRefine(ruleRefine);

export type RuleInput = z.infer<typeof createRuleSchema>;

export const listRewardsQuery = z.object({
  ...paginationQuery,
  status: z
    .enum(['pending_approval', 'issued', 'redeemed', 'expired', 'cancelled', 'rejected'])
    .optional(),
  search: z.string().trim().max(60).optional(),
});

export const listIncidentsQuery = z.object({
  ...paginationQuery,
  status: z.enum(INCIDENT_STATUSES).optional(),
});

export const decisionSchema = z.object({ note: z.string().trim().max(300).optional() }).strict();

export const issueSchema = z
  .object({
    ruleId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
  })
  .strict();

export const deliverSchema = z
  .object({ method: z.enum(['copy', 'whatsapp_link', 'email_link', 'in_person']) })
  .strict();

export const codeSchema = z.object({ code: z.string().trim().min(6).max(30) }).strict();

export const redeemSchema = z
  .object({
    code: z.string().trim().min(6).max(30),
    requestId: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    orderTotal: money.optional(),
    orderId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const summaryQuery = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});
