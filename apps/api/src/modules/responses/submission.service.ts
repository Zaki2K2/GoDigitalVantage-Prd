import { AppError } from '../../shared/errors';
import { normalizeEmail, normalizePhone } from '../contacts/normalize';
import type { ConsentPurpose } from '../contacts/contact.model';
import {
  CONSENT_WORDING_VERSION,
  recordConsent,
  touchContact,
  upsertContact,
  type ContactInput,
} from '../contacts/contact.service';
import type { ContentData } from '../questionnaires/questionnaire.model';
import { loadPublished } from '../questionnaires/questionnaire.service';
import { Contact } from '../contacts/contact.model';
import { processSubmission, type Client } from '../rewards/reward.service';
import { Response, type AnswerSnapshot, type ResponseDoc } from './response.model';
import type { SubmissionInput } from './response.schemas';

export interface SubmissionIssue {
  questionId: string | null;
  field: string;
  message: string;
}

const MAX_SHORT = 300;
const MAX_LONG = 2000;
const MAX_NAME = 120;

export interface ValidatedSubmission {
  answers: AnswerSnapshot[];
  rating: number | null;
  contact: ContactInput | null;
  grants: ConsentPurpose[];
  issues: SubmissionIssue[];
}

/** Checks a submission against one immutable questionnaire version and builds the snapshots. */
export function validateSubmission(form: ContentData, input: SubmissionInput): ValidatedSubmission {
  const issues: SubmissionIssue[] = [];
  const byId = new Map<string, SubmissionInput['answers'][number]>();
  const known = new Set(form.questions.map((q) => q.id));
  for (const a of input.answers) {
    if (!known.has(a.questionId)) {
      issues.push({ questionId: null, field: 'answers', message: 'Unknown question in answers' });
    } else if (byId.has(a.questionId)) {
      issues.push({
        questionId: a.questionId,
        field: 'answers',
        message: 'This question was answered twice',
      });
    } else {
      byId.set(a.questionId, a);
    }
  }

  const answers: AnswerSnapshot[] = [];
  for (const q of form.questions) {
    const raw = byId.get(q.id);
    const base = { questionId: q.id, type: q.type, label: q.label, required: q.required };
    const issue = (message: string) => issues.push({ questionId: q.id, field: 'answer', message });
    let snapshot: AnswerSnapshot | null = null;

    if (q.type === 'short_text' || q.type === 'long_text') {
      const text = (raw?.text ?? '').trim();
      const max = q.type === 'short_text' ? MAX_SHORT : MAX_LONG;
      if (text.length > max) issue(`Please keep this under ${max} characters`);
      else if (text) snapshot = { ...base, text, rating: null, choices: [] };
    } else if (q.type === 'rating') {
      const r = raw?.rating;
      if (r !== undefined && r !== null) {
        if (!Number.isInteger(r) || r < 1 || r > 5) issue('Choose a rating from 1 to 5');
        else snapshot = { ...base, text: null, rating: r, choices: [] };
      }
    } else {
      const ids = [...new Set(raw?.choiceIds ?? [])];
      const picked = ids.map((id) => q.choices.find((c) => c.id === id));
      if (picked.some((c) => !c)) issue('Choose one of the listed options');
      else if (q.type === 'single_choice' && ids.length > 1) issue('Choose only one option');
      else if (ids.length > 0) {
        snapshot = {
          ...base,
          text: null,
          rating: null,
          choices: picked.map((c) => ({ id: c!.id, label: c!.label })),
        };
      }
    }
    if (snapshot) answers.push(snapshot);
    else if (q.required && !issues.some((i) => i.questionId === q.id)) {
      issue('This question is required');
    }
  }
  if (answers.length === 0 && issues.length === 0) {
    issues.push({
      questionId: null,
      field: 'answers',
      message: 'Please answer at least one question',
    });
  }

  // Contact: optional. Without an email or phone the response stays anonymous.
  const name = (input.contact?.fullName ?? '').trim();
  const emailRaw = (input.contact?.email ?? '').trim();
  const phoneRaw = (input.contact?.phone ?? '').trim();
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (name.length > MAX_NAME) {
    issues.push({ questionId: null, field: 'contact.fullName', message: 'Name is too long' });
  }
  if (emailRaw && !email) {
    issues.push({
      questionId: null,
      field: 'contact.email',
      message: 'Enter a valid email address',
    });
  }
  if (phoneRaw && !phone) {
    issues.push({
      questionId: null,
      field: 'contact.phone',
      message: 'Enter a phone number with country code, e.g. +14155550123',
    });
  }
  if (name && !emailRaw && !phoneRaw) {
    issues.push({
      questionId: null,
      field: 'contact',
      message:
        'Add an email or phone number so we can reach you, or clear your name to stay anonymous',
    });
  }

  const grants: ConsentPurpose[] = [];
  if (input.consent?.reviewRequestSms === true) grants.push('review_request_sms');
  if (input.consent?.marketingSms === true) grants.push('marketing_sms');
  if (grants.length > 0 && !phone) {
    issues.push({
      questionId: null,
      field: 'consent',
      message: 'Text message permission needs a valid phone number',
    });
  }

  const rating = answers.find((a) => a.type === 'rating')?.rating ?? null;
  const contact = email || phone ? { fullName: name || null, email, phone } : null;
  return { answers, rating, contact, grants, issues };
}

export interface SubmissionResult {
  responseId: string;
  duplicate: boolean;
  googleReviewUrl: string | null;
  /** Complaint-recovery reward, when the rating matched an enabled rule and the customer qualified. */
  reward: Awaited<ReturnType<typeof processSubmission>>;
}

export async function submitResponse(
  slug: string,
  input: SubmissionInput,
  client: Client = { ip: '', userAgent: '' },
): Promise<SubmissionResult> {
  const { business, questionnaire, version } = await loadPublished(slug, input.version);
  const reviewUrl =
    business.googleReviewUrl && /^https:\/\//.test(business.googleReviewUrl)
      ? business.googleReviewUrl
      : null;
  const businessId = business._id;

  /** Never fails the submission: the response is already stored; a retry re-runs this idempotently. */
  const rewardFor = async (doc: ResponseDoc) => {
    try {
      const c = doc.contactId ? await Contact.findById(doc.contactId).lean() : null;
      return await processSubmission(doc, c, client);
    } catch (err) {
      console.error('Reward processing failed:', err instanceof Error ? err.message : err);
      return null;
    }
  };

  const replay = async (doc: ResponseDoc): Promise<SubmissionResult> => {
    // Re-applies consent from the stored snapshot (idempotent) in case a first attempt crashed.
    const s = doc.consentSnapshot;
    if (doc.contactId && s && (s.reviewRequestSms || s.marketingSms)) {
      const grants: ConsentPurpose[] = [];
      if (s.reviewRequestSms) grants.push('review_request_sms');
      if (s.marketingSms) grants.push('marketing_sms');
      await recordConsent(
        businessId,
        doc.contactId,
        grants,
        business.name,
        doc.idempotencyKey,
        doc.submittedAt,
      );
    }
    return {
      responseId: String(doc._id),
      duplicate: true,
      googleReviewUrl: reviewUrl,
      reward: await rewardFor(doc),
    };
  };

  const prior = await Response.findOne({ businessId, idempotencyKey: input.idempotencyKey }).lean();
  if (prior) return replay(prior);

  const v = validateSubmission(version, input);
  if (v.issues.length > 0) {
    throw new AppError(422, 'SUBMISSION_INVALID', 'Please fix the highlighted answers', {
      issues: v.issues,
    });
  }

  const now = new Date();
  const contact = v.contact ? await upsertContact(businessId, v.contact, now) : null;
  let doc: ResponseDoc;
  try {
    doc = (
      await Response.create({
        businessId,
        questionnaireId: questionnaire._id,
        questionnaireVersion: version.version,
        contactId: contact?._id ?? null,
        answers: v.answers,
        rating: v.rating,
        consentSnapshot: contact
          ? {
              reviewRequestSms: v.grants.includes('review_request_sms'),
              marketingSms: v.grants.includes('marketing_sms'),
              wordingVersion: CONSENT_WORDING_VERSION,
            }
          : null,
        idempotencyKey: input.idempotencyKey,
        submittedAt: now,
      })
    ).toObject();
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const winner = await Response.findOne({
      businessId,
      idempotencyKey: input.idempotencyKey,
    }).lean();
    if (!winner) throw err;
    return replay(winner);
  }

  if (contact) {
    if (v.grants.length > 0) {
      await recordConsent(
        businessId,
        contact._id,
        v.grants,
        business.name,
        doc.idempotencyKey,
        now,
      );
    } else {
      await touchContact(contact._id, now);
    }
  }
  return {
    responseId: String(doc._id),
    duplicate: false,
    googleReviewUrl: reviewUrl,
    reward: await rewardFor(doc),
  };
}
