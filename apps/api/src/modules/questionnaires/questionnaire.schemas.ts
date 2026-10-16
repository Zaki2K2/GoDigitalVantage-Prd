import { z } from 'zod';
import { CHOICE_TYPES, QUESTION_TYPES } from './questionnaire.model';

const optId = z.string().trim().min(1).max(64).optional();

const choice = z.object({ id: optId, label: z.string().trim().max(120) }).strict();

const question = z
  .object({
    id: optId,
    type: z.enum(QUESTION_TYPES),
    label: z.string().trim().max(300),
    helpText: z
      .string()
      .trim()
      .max(500)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    required: z.boolean(),
    choices: z.array(choice).max(10).default([]),
  })
  .strict()
  .refine((q) => CHOICE_TYPES.includes(q.type) || q.choices.length === 0, {
    message: 'Only choice questions can have choices',
    path: ['choices'],
  });

/**
 * Drafts may be incomplete (blank labels, too few choices) so owners can save work in progress.
 * Completeness is enforced separately at publish time (see `publishIssues`).
 */
export const saveDraftSchema = z
  .object({
    baseRevision: z.number().int().min(1),
    title: z.string().trim().min(1).max(120),
    description: z
      .string()
      .trim()
      .max(500)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    questions: z.array(question).max(30),
  })
  .strict();

export const publishSchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

export const versionParam = z.object({ version: z.coerce.number().int().min(1) });

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export interface PublishIssue {
  questionId: string | null;
  field: 'title' | 'questions' | 'label' | 'choices';
  message: string;
}

interface DraftLike {
  title: string;
  questions: {
    id: string;
    type: string;
    label: string;
    choices: { label: string }[];
  }[];
}

/** Everything that must be true before a draft may become a public version. */
export function publishIssues(draft: DraftLike): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (draft.title.trim() === '') {
    issues.push({ questionId: null, field: 'title', message: 'Add a title' });
  }
  if (draft.questions.length === 0) {
    issues.push({ questionId: null, field: 'questions', message: 'Add at least one question' });
  }
  for (const q of draft.questions) {
    if (q.label.trim() === '') {
      issues.push({ questionId: q.id, field: 'label', message: 'Question text is empty' });
    }
    if (CHOICE_TYPES.includes(q.type as (typeof QUESTION_TYPES)[number])) {
      const labels = q.choices.map((c) => c.label.trim().toLowerCase());
      if (labels.length < 2) {
        issues.push({ questionId: q.id, field: 'choices', message: 'Add at least two choices' });
      } else if (labels.some((l) => l === '')) {
        issues.push({ questionId: q.id, field: 'choices', message: 'A choice is empty' });
      } else if (new Set(labels).size !== labels.length) {
        issues.push({ questionId: q.id, field: 'choices', message: 'Choices must be different' });
      }
    }
  }
  return issues;
}
