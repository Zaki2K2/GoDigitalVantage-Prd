import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError, forbidden, notFound } from '../../shared/errors';
import { imageUrl } from '../images/image-url';
import { Business, ONBOARDING_STEPS, type BusinessDoc } from './business.model';
import { BusinessMembership, type MembershipRole } from './membership.model';
import { ensureQuestionnaire, hasPublished } from '../questionnaires/questionnaire.service';
import type {
  CreateBusinessInput,
  UpdateBusinessInput,
  UpdateOnboardingInput,
} from './business.schemas';

export function toBusinessDto(b: BusinessDoc, role: MembershipRole) {
  return {
    id: b._id.toString(),
    name: b.name,
    category: b.category,
    email: b.email,
    phone: b.phone,
    address: b.address,
    logoRef: b.logoRef,
    logoUrl: imageUrl(`/api/v1/businesses/${b._id.toString()}/logo`, b.logoUpdatedAt),
    timezone: b.timezone,
    googleReviewUrl: b.googleReviewUrl,
    slug: b.slug,
    status: b.status,
    onboarding: {
      currentStep: b.onboarding?.currentStep ?? 'business',
      completedSteps: b.onboarding?.completedSteps ?? [],
      completedAt: b.onboarding?.completedAt ?? null,
    },
    role,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/** Membership query used by `requireBusinessAccess`. */
export async function findMembership(userId: string, businessId: string) {
  // Both reads are independent. Keep every live authorization check, but pay one network round.
  const [m, b] = await Promise.all([
    BusinessMembership.findOne({ userId, businessId }).lean(),
    Business.findById(businessId, { adminState: 1, status: 1 }).lean(),
  ]);
  if (!m || m.status === 'disabled') return null;
  return b && b.status !== 'disabled' && (!b.adminState || b.adminState === 'active')
    ? { role: m.role }
    : null;
}

function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'business';
}

const isDuplicateKey = (err: unknown): err is { code: number; keyPattern?: Record<string, 1> } =>
  (err as { code?: number }).code === 11000;

async function ensureOwnerMembership(businessId: Types.ObjectId, userId: Types.ObjectId) {
  await BusinessMembership.updateOne(
    { businessId, userId },
    { $setOnInsert: { role: 'owner' } },
    { upsert: true },
  );
  // Every business starts with an editable default questionnaire (idempotent).
  await ensureQuestionnaire(businessId);
}

export async function createBusiness(userId: string, input: CreateBusinessInput) {
  const owner = new Types.ObjectId(userId);
  const { createRequestId, ...profile } = input;

  const existing = await Business.findOne({ ownerUserId: owner, createRequestId }).lean();
  if (existing) {
    // Heal a crash between the two writes, then return the same business.
    await ensureOwnerMembership(existing._id, owner);
    return { business: toBusinessDto(existing, 'owner'), created: false };
  }

  const base = slugify(profile.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
    try {
      const doc = await Business.create({ ...profile, ownerUserId: owner, createRequestId, slug });
      await ensureOwnerMembership(doc._id, owner);
      return { business: toBusinessDto(doc.toObject(), 'owner'), created: true };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      if (err.keyPattern?.['createRequestId'] !== undefined) {
        // Lost a race with an identical concurrent submission.
        const winner = await Business.findOne({ ownerUserId: owner, createRequestId }).lean();
        if (winner) {
          await ensureOwnerMembership(winner._id, owner);
          return { business: toBusinessDto(winner, 'owner'), created: false };
        }
      }
      // otherwise a slug collision: retry with a random suffix
    }
  }
  throw new AppError(503, 'SLUG_UNAVAILABLE', 'Could not allocate a unique business URL');
}

export async function listBusinesses(userId: string) {
  const memberships = await BusinessMembership.find({ userId, status: { $ne: 'disabled' } }).lean();
  const businesses = await Business.find({ _id: { $in: memberships.map((m) => m.businessId) } })
    .sort({ createdAt: 1 })
    .lean();
  const roles = new Map(memberships.map((m) => [m.businessId.toString(), m.role]));
  return businesses.map((b) => toBusinessDto(b, roles.get(b._id.toString()) ?? 'member'));
}

export async function getBusiness(businessId: string, role: MembershipRole) {
  const b = await Business.findById(businessId).lean();
  if (!b) throw notFound('Business not found');
  return toBusinessDto(b, role);
}

export async function updateBusiness(
  businessId: string,
  role: MembershipRole,
  input: UpdateBusinessInput,
) {
  if (role !== 'owner') throw forbidden('Only the owner can edit the business');
  const b = await Business.findByIdAndUpdate(
    businessId,
    { $set: input },
    { returnDocument: 'after' },
  ).lean();
  if (!b) throw notFound('Business not found');
  return toBusinessDto(b, role);
}

export async function updateOnboarding(
  businessId: string,
  role: MembershipRole,
  input: UpdateOnboardingInput,
) {
  if (role !== 'owner') throw forbidden('Only the owner can change onboarding');
  const b = await Business.findById(businessId);
  if (!b) throw notFound('Business not found');

  const current = b.onboarding?.currentStep ?? 'business';
  const idx = (s: string) => ONBOARDING_STEPS.findIndex((x) => x === s);

  if (input.currentStep !== undefined) {
    // Going back is always allowed; going forward only one step at a time.
    if (idx(input.currentStep) > idx(current) + 1) {
      throw new AppError(409, 'STEP_NOT_AVAILABLE', 'Finish the previous step first');
    }
    if (idx(input.currentStep) > idx('questionnaire') && !(await hasPublished(businessId))) {
      throw new AppError(409, 'QUESTIONNAIRE_NOT_PUBLISHED', 'Publish your questionnaire first');
    }
    b.set('onboarding.currentStep', input.currentStep);
  }
  if (input.completeStep === 'confirm') {
    if (idx(b.onboarding?.currentStep ?? 'business') < idx('confirm')) {
      throw new AppError(409, 'STEP_NOT_AVAILABLE', 'Review your details before confirming');
    }
    if (!b.onboarding?.completedSteps.includes('confirm')) {
      b.onboarding?.completedSteps.push('confirm');
    }
  }
  // completedAt stays null until the questionnaire and QR steps exist (M-FORM / M-QR).
  await b.save();
  return toBusinessDto(b.toObject(), role);
}

/**
 * Completion is decided from real server state, never from client claims: details confirmed and
 * a questionnaire version actually published (the QR/public URL is derived from the immutable
 * slug, so it is ready as soon as a version is public).
 */
export async function finishOnboarding(businessId: string, role: MembershipRole) {
  if (role !== 'owner') throw forbidden('Only the owner can finish onboarding');
  const b = await Business.findById(businessId);
  if (!b) throw notFound('Business not found');

  const missing: string[] = [];
  if (!b.onboarding?.completedSteps.includes('confirm')) missing.push('confirm');
  if (!(await hasPublished(businessId))) missing.push('questionnaire');
  if (missing.length > 0) {
    throw new AppError(409, 'ONBOARDING_INCOMPLETE', 'Finish the required setup steps first', {
      missing,
    });
  }

  b.set('onboarding.completedSteps', [...ONBOARDING_STEPS]);
  b.set('onboarding.currentStep', 'qr');
  if (!b.onboarding?.completedAt) b.set('onboarding.completedAt', new Date());
  b.set('status', 'active');
  await b.save();
  return toBusinessDto(b.toObject(), role);
}
