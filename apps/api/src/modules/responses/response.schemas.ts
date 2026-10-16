import { z } from 'zod';
import { paginationQuery } from '../../shared/pagination';

const answer = z
  .object({
    questionId: z.string().trim().min(1).max(64),
    text: z.string().max(5000).optional(),
    rating: z.number().optional(),
    choiceIds: z.array(z.string().max(64)).max(20).optional(),
  })
  .strict();

/**
 * Only shapes are checked here; per-question rules (required, ranges, choices) run against the
 * questionnaire version in `validateSubmission` so errors can point at the offending question.
 */
export const submissionSchema = z
  .object({
    idempotencyKey: z
      .string()
      .min(16)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    version: z.number().int().min(1).optional(),
    answers: z.array(answer).max(60),
    contact: z
      .object({
        fullName: z.string().max(200).optional(),
        email: z.string().max(300).optional(),
        phone: z.string().max(60).optional(),
      })
      .strict()
      .optional(),
    consent: z
      .object({
        reviewRequestSms: z.boolean().optional(),
        marketingSms: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** Honeypot: real visitors never see or fill this field. */
    website: z.string().max(500).optional(),
  })
  .strict();

export type SubmissionInput = z.infer<typeof submissionSchema>;

export const listResponsesQuery = z.object({
  ...paginationQuery,
  search: z.string().trim().max(100).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  contact: z.enum(['identified', 'anonymous']).optional(),
  version: z.coerce.number().int().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListResponsesQuery = z.infer<typeof listResponsesQuery>;
