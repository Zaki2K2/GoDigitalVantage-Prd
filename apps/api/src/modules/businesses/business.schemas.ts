import { z } from 'zod';
import { ONBOARDING_STEPS } from './business.model';

/** Optional text: trimmed, empty string becomes null, null clears the field. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA timezone');

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be a valid https URL')
  .or(z.literal('').transform(() => null))
  .nullable()
  .optional();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.union([z.email(), z.literal('')]))
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const phone = z
  .string()
  .trim()
  .max(24)
  .refine((v) => v === '' || /^\+?[0-9 ()\-.]{6,24}$/.test(v), 'Invalid phone number')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const profileFields = {
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  email,
  phone,
  address: optText(300),
  logoRef: optText(500),
  timezone,
  googleReviewUrl: httpsUrl,
};

export const createBusinessSchema = z
  .object({ createRequestId: z.uuid(), ...profileFields })
  .strict();

export const updateBusinessSchema = z.object(profileFields).partial().strict();

export const businessIdParam = z.object({ businessId: z.string().regex(/^[a-f\d]{24}$/i) });

/** Only steps that can truly be finished in M1 may be completed; the rest arrive with M-FORM/M-QR. */
export const updateOnboardingSchema = z
  .object({
    currentStep: z.enum(ONBOARDING_STEPS).optional(),
    completeStep: z.literal('confirm').optional(),
  })
  .strict()
  .refine((v) => v.currentStep !== undefined || v.completeStep !== undefined, {
    message: 'Provide currentStep or completeStep',
  });

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingSchema>;
