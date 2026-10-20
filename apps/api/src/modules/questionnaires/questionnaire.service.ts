import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError, notFound } from '../../shared/errors';
import { Business } from '../businesses/business.model';
import { imageUrl } from '../images/image-url';
import {
  Questionnaire,
  QuestionnaireVersion,
  type ContentData,
  type QuestionnaireDoc,
  type VersionDoc,
} from './questionnaire.model';
import { publishIssues, type SaveDraftInput } from './questionnaire.schemas';

type Content = ContentData;

const q = (label: string, type: 'rating' | 'long_text', required: boolean) => ({
  id: randomUUID(),
  type,
  label,
  helpText: null,
  required,
  choices: [],
});

/** Starter questionnaire created with every business; owners edit it before publishing. */
function defaultDraft(): Content {
  return {
    title: 'Tell us about your visit',
    description: null,
    questions: [
      q('How would you rate your experience?', 'rating', true),
      q('What did you like most?', 'long_text', false),
      q('How could we improve?', 'long_text', false),
    ],
  };
}

const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;

/** Idempotent: safe to call from business creation and lazily for older businesses. */
export async function ensureQuestionnaire(businessId: string | Types.ObjectId) {
  const id = new Types.ObjectId(businessId);
  const existing = await Questionnaire.findOne({ businessId: id }).lean();
  if (existing) return existing;
  try {
    return (await Questionnaire.create({ businessId: id, draft: defaultDraft() })).toObject();
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const winner = await Questionnaire.findOne({ businessId: id }).lean();
    if (!winner) throw err;
    return winner;
  }
}

function toContent(c: Content) {
  return {
    title: c.title,
    description: c.description ?? null,
    questions: c.questions.map((x) => ({
      id: x.id,
      type: x.type,
      label: x.label,
      helpText: x.helpText ?? null,
      required: x.required,
      choices: x.choices.map((ch) => ({ id: ch.id, label: ch.label })),
    })),
  };
}

async function toView(doc: QuestionnaireDoc) {
  const versions = await QuestionnaireVersion.find({ questionnaireId: doc._id })
    .sort({ version: -1 })
    .lean();
  const draft = toContent(doc.draft);
  return {
    draft,
    draftRevision: doc.draftRevision,
    publishedRevision: doc.publishedRevision,
    publishedVersion: doc.publishedVersion,
    hasUnpublishedChanges: doc.draftRevision !== doc.publishedRevision,
    issues: publishIssues(draft),
    versions: versions.map((v) => ({
      version: v.version,
      publishedAt: v.publishedAt,
      questionCount: v.questions.length,
    })),
  };
}

export async function getQuestionnaire(businessId: string) {
  return toView(await ensureQuestionnaire(businessId));
}

/** Assigns ids to new questions/choices and rejects duplicates, so ids stay stable across edits. */
function withIds(input: SaveDraftInput): Content {
  const seen = new Set<string>();
  const unique = (id: string | undefined): string => {
    const value = id ?? randomUUID();
    if (seen.has(value)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Duplicate question or choice id', {
        questions: ['Question and choice ids must be unique'],
      });
    }
    seen.add(value);
    return value;
  };
  return {
    title: input.title,
    description: input.description ?? null,
    questions: input.questions.map((x) => ({
      id: unique(x.id),
      type: x.type,
      label: x.label,
      helpText: x.helpText ?? null,
      required: x.required,
      choices: x.choices.map((c) => ({ id: unique(c.id), label: c.label })),
    })),
  };
}

export async function saveDraft(businessId: string, input: SaveDraftInput) {
  await ensureQuestionnaire(businessId);
  const updated = await Questionnaire.findOneAndUpdate(
    { businessId, draftRevision: input.baseRevision },
    { $set: { draft: withIds(input) }, $inc: { draftRevision: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) {
    throw new AppError(
      409,
      'REVISION_CONFLICT',
      'The questionnaire was changed elsewhere. Reload to continue.',
    );
  }
  return toView(updated);
}

/**
 * Publishes the draft as a new immutable version. The version number and the "this revision is
 * published" marker are claimed in one atomic update, so concurrent publishes of the same draft
 * produce exactly one version and the loser gets a 409.
 */
export async function publish(businessId: string, userId: string, expectedRevision: number) {
  const current = await ensureQuestionnaire(businessId);
  if (current.draftRevision !== expectedRevision) {
    throw new AppError(409, 'REVISION_CONFLICT', 'The draft changed. Reload before publishing.');
  }
  if (current.publishedRevision === expectedRevision) {
    throw new AppError(409, 'NOTHING_TO_PUBLISH', 'There are no unpublished changes');
  }
  const issues = publishIssues(toContent(current.draft));
  if (issues.length > 0) {
    throw new AppError(422, 'QUESTIONNAIRE_INVALID', 'Fix the highlighted problems to publish', {
      issues,
    });
  }

  const claimed = await Questionnaire.findOneAndUpdate(
    {
      _id: current._id,
      draftRevision: expectedRevision,
      publishedRevision: { $ne: expectedRevision },
    },
    { $set: { publishedRevision: expectedRevision }, $inc: { versionCounter: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!claimed) {
    throw new AppError(409, 'REVISION_CONFLICT', 'Another change was published first. Reload.');
  }

  try {
    await QuestionnaireVersion.create({
      businessId: claimed.businessId,
      questionnaireId: claimed._id,
      version: claimed.versionCounter,
      ...toContent(claimed.draft),
      publishedAt: new Date(),
      publishedByUserId: new Types.ObjectId(userId),
    });
  } catch (err) {
    // Release the claim so the owner can retry; the burned version number is harmless.
    await Questionnaire.updateOne(
      { _id: claimed._id, publishedRevision: expectedRevision },
      { $set: { publishedRevision: current.publishedRevision } },
    );
    throw err;
  }
  const done = await Questionnaire.findOneAndUpdate(
    { _id: claimed._id },
    { $max: { publishedVersion: claimed.versionCounter } },
    { returnDocument: 'after' },
  ).lean();
  await Business.updateOne(
    { _id: claimed.businessId },
    { $addToSet: { 'onboarding.completedSteps': 'questionnaire' } },
  );
  return toView(done ?? claimed);
}

export async function getVersion(businessId: string, version: number) {
  const v = await QuestionnaireVersion.findOne({ businessId, version }).lean();
  if (!v) throw notFound('Version not found');
  return versionDto(v);
}

function versionDto(v: VersionDoc) {
  return { version: v.version, publishedAt: v.publishedAt, ...toContent(v) };
}

export async function hasPublished(businessId: string): Promise<boolean> {
  return (
    (await Questionnaire.exists({
      businessId,
      adminArchived: { $ne: true },
      publishedVersion: { $gt: 0 },
    })) !== null
  );
}

const UNAVAILABLE = () =>
  new AppError(404, 'FORM_UNAVAILABLE', 'This feedback form is not available.');

/**
 * Resolves a public slug to its business and a published questionnaire version (the current one,
 * or an older published version when `version` is given). Every unavailable case is the same 404.
 */
export async function loadPublished(slug: string, version?: number) {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) throw UNAVAILABLE();
  const business = await Business.findOne({ slug }).lean();
  if (
    !business ||
    business.status === 'disabled' ||
    (business.adminState && business.adminState !== 'active')
  )
    throw UNAVAILABLE();
  const qn = await Questionnaire.findOne({ businessId: business._id }).lean();
  if (!qn || qn.adminArchived || qn.publishedVersion < 1) throw UNAVAILABLE();
  const wanted = version ?? qn.publishedVersion;
  if (wanted < 1 || wanted > qn.publishedVersion) throw UNAVAILABLE();
  const v = await QuestionnaireVersion.findOne({
    questionnaireId: qn._id,
    version: wanted,
  }).lean();
  if (!v) throw UNAVAILABLE();
  return { business, questionnaire: qn, version: v };
}

/** Anonymous read of the currently published questionnaire for a public slug. */
export async function getPublicForm(slug: string) {
  const { business, version } = await loadPublished(slug);
  const url = business.googleReviewUrl;
  return {
    business: {
      name: business.name,
      slug: business.slug,
      category: business.category,
      googleReviewUrl: url && /^https:\/\//.test(url) ? url : null,
      logoUrl: imageUrl(`/api/v1/public/${business.slug}/logo`, business.logoUpdatedAt),
    },
    questionnaire: versionDto(version),
  };
}
