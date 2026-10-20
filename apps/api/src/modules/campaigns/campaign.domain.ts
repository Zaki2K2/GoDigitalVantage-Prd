import { z } from 'zod';

export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;
export const TRIGGERS = [
  'once',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'birthday',
  'anniversary',
  'welcome',
  'inactive',
] as const;
export const AUDIENCES = [
  'all',
  'selected',
  'tags',
  'segment',
  'birthday',
  'inactive',
  'new',
  'loyal',
  'filters',
] as const;
export const idSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i)
  .transform((v) => v.toLowerCase());
const monthDay = z
  .string()
  .regex(/^\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`2000-${v}T00:00:00Z`);
    return Number.isFinite(+d) && d.toISOString().slice(5, 10) === v;
  }, 'Use a valid MM-DD');
export const profileSchema = z
  .object({
    birthday: monthDay.nullable().optional(),
    anniversary: monthDay.nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    segment: z.string().trim().max(80).nullable().optional(),
    loyaltyLevel: z.string().trim().max(80).nullable().optional(),
  })
  .strict();
export const campaignInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    campaignType: z
      .enum(['promotion', 'retention', 'welcome', 'loyalty', 'seasonal', 'custom'])
      .default('promotion'),
    audience: z
      .object({
        type: z.enum(AUDIENCES).default('all'),
        contactIds: z.array(idSchema).max(1000).default([]),
        tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
        segment: z.string().max(80).default(''),
        loyaltyLevel: z.string().max(80).default(''),
        inactiveDays: z.number().int().min(1).max(3650).default(90),
        newDays: z.number().int().min(1).max(365).default(7),
        minInteractions: z.number().int().min(0).max(100000).default(0),
      })
      .strict(),
    startDate: z.iso.datetime().transform((v) => new Date(v)),
    endDate: z.iso.datetime().transform((v) => new Date(v)),
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid timezone'),
    trigger: z
      .object({
        type: z.enum(TRIGGERS),
        weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
        dayOfMonth: z.number().int().min(1).max(31).default(1),
        month: z.number().int().min(1).max(12).default(1),
        sendTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .default('09:00'),
        endTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .default('23:59'),
        daysBefore: z.number().int().min(0).max(30).default(0),
      })
      .strict(),
    channels: z.array(z.enum(['email'])).length(1),
    offer: z
      .object({
        discountType: z.enum(['percent', 'fixed']),
        discountValue: z.number().positive().max(1000000),
        currency: z.string().regex(/^[A-Z]{3}$/),
        minSpend: z.number().min(0).nullable().default(null),
        maxDiscount: z.number().positive().nullable().default(null),
        validityDays: z.number().int().min(1).max(365),
        terms: z.string().max(2000).default(''),
      })
      .strict(),
    usageLimit: z.number().int().min(1).max(1000000).default(1000),
    perCustomerLimit: z.number().int().min(1).max(1000).default(1),
    priority: z.number().int().min(0).max(100).default(0),
    offerPolicy: z.enum(['exclusive', 'parallel']).default('exclusive'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (+v.endDate <= +v.startDate)
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End must follow start' });
    if (v.offer.discountType === 'percent' && v.offer.discountValue > 100)
      ctx.addIssue({ code: 'custom', path: ['offer'], message: 'Percentage cannot exceed 100' });
    if (v.trigger.type === 'weekly' && !v.trigger.weekdays.length)
      ctx.addIssue({ code: 'custom', path: ['trigger'], message: 'Select weekdays' });
    if (v.trigger.endTime < v.trigger.sendTime)
      ctx.addIssue({
        code: 'custom',
        path: ['trigger'],
        message: 'End time must follow send time',
      });
    if (v.audience.type === 'selected' && !v.audience.contactIds.length)
      ctx.addIssue({ code: 'custom', path: ['audience'], message: 'Select contacts' });
    if (v.audience.type === 'tags' && !v.audience.tags.length)
      ctx.addIssue({ code: 'custom', path: ['audience'], message: 'Select tags' });
    if (v.audience.type === 'segment' && !v.audience.segment)
      ctx.addIssue({ code: 'custom', path: ['audience'], message: 'Select a segment' });
    if (v.audience.type === 'loyal' && !v.audience.loyaltyLevel && !v.audience.minInteractions)
      ctx.addIssue({
        code: 'custom',
        path: ['audience'],
        message: 'Choose loyalty level or interaction threshold',
      });
  });
export type CampaignInput = z.infer<typeof campaignInput>;
export function campaignConfig(c: CampaignInput): CampaignInput {
  return campaignInput.parse({
    name: c.name,
    description: c.description,
    campaignType: c.campaignType,
    offerPolicy: c.offerPolicy ?? 'exclusive',
    audience: c.audience,
    startDate: new Date(c.startDate).toISOString(),
    endDate: new Date(c.endDate).toISOString(),
    timezone: c.timezone,
    trigger: c.trigger,
    channels: c.channels,
    offer: c.offer,
    usageLimit: c.usageLimit,
    perCustomerLimit: c.perCustomerLimit,
    priority: c.priority,
  });
}
export function localParts(now: Date, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = `${p['year']}-${p['month']}-${p['day']}`;
  return {
    date,
    time: `${p['hour']}:${p['minute']}`,
    year: p['year']!,
    month: Number(p['month']),
    day: Number(p['day']),
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
  };
}
export function executionWindow(c: CampaignInput, now: Date): string | null {
  if (now < c.startDate || now >= c.endDate) return null;
  const p = localParts(now, c.timezone),
    t = c.trigger;
  if (p.time < t.sendTime || p.time > t.endTime) return null;
  if (t.type === 'weekly' && !t.weekdays.includes(p.weekday)) return null;
  if ((t.type === 'monthly' || t.type === 'yearly') && p.day !== t.dayOfMonth) return null;
  if (t.type === 'yearly' && p.month !== t.month) return null;
  return t.type === 'once' ? 'once' : p.date;
}
export function occasionDate(c: CampaignInput, now: Date) {
  const p = localParts(now, c.timezone);
  const d = new Date(`${p.date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + c.trigger.daysBefore);
  return { monthDay: d.toISOString().slice(5, 10), year: d.getUTCFullYear() };
}
export const CAMPAIGN_TEMPLATES = [
  {
    id: 'birthday',
    name: 'Birthday Deal',
    trigger: { type: 'birthday', daysBefore: 0 },
    campaignType: 'promotion',
  },
  {
    id: 'weekend',
    name: 'Weekend Offer',
    trigger: { type: 'weekly', weekdays: [0, 6] },
    campaignType: 'promotion',
  },
  {
    id: 'tuesday',
    name: 'Tuesday Special',
    trigger: { type: 'weekly', weekdays: [2] },
    campaignType: 'promotion',
  },
  {
    id: 'welcome',
    name: 'Welcome Campaign',
    trigger: { type: 'welcome' },
    campaignType: 'welcome',
  },
  {
    id: 'winback',
    name: 'Win-back Campaign',
    trigger: { type: 'inactive' },
    campaignType: 'retention',
  },
  {
    id: 'loyalty',
    name: 'Loyalty Reward',
    trigger: { type: 'monthly' },
    campaignType: 'loyalty',
    audience: { type: 'loyal', minInteractions: 5 },
  },
] as const;
