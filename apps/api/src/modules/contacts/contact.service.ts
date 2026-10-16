import { Types, type QueryFilter } from 'mongoose';
import { z } from 'zod';
import { escapeRegex, OBJECT_ID, pageMeta, paginationQuery } from '../../shared/pagination';
import { notFound } from '../../shared/errors';
import { Response } from '../responses/response.model';
import { ConsentEvent, Contact, type ConsentPurpose, type ContactDoc } from './contact.model';

/** Wording shown to the customer and snapshotted on every grant. Bump the version on any change. */
export const CONSENT_WORDING_VERSION = '2026-10-v1';
export const consentWording = (businessName: string): Record<ConsentPurpose, string> => ({
  review_request_sms: `Text me a link to leave a Google review for ${businessName}. (Optional)`,
  marketing_sms: `Send me occasional promotional text messages from ${businessName}. Message and data rates may apply; reply STOP to opt out. (Optional)`,
});

const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;

export interface ContactInput {
  fullName: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Finds or creates the contact for this business (phone match first, then email) and fills only
 * fields that are still empty. Public submitters can never overwrite what is already stored, so a
 * stranger typing someone else's phone number cannot rewrite their record.
 */
export async function upsertContact(
  businessId: Types.ObjectId,
  input: ContactInput,
  now: Date,
): Promise<ContactDoc> {
  const find = async () => {
    if (input.phone) {
      const byPhone = await Contact.findOne({ businessId, phoneE164: input.phone });
      if (byPhone) return byPhone;
    }
    return input.email ? Contact.findOne({ businessId, emailLowercase: input.email }) : null;
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await find();
    if (!existing) {
      try {
        const created = await Contact.create({
          businessId,
          fullName: input.fullName,
          emailLowercase: input.email,
          phoneE164: input.phone,
          firstResponseAt: now,
          lastResponseAt: now,
        });
        return created.toObject();
      } catch (err) {
        if (isDuplicateKey(err)) continue; // concurrent submit created it: re-read
        throw err;
      }
    }
    const fill: Record<string, string> = {};
    if (!existing.fullName && input.fullName) fill['fullName'] = input.fullName;
    if (!existing.emailLowercase && input.email) fill['emailLowercase'] = input.email;
    if (!existing.phoneE164 && input.phone) fill['phoneE164'] = input.phone;
    if (Object.keys(fill).length === 0) return existing.toObject();
    try {
      await Contact.updateOne({ _id: existing._id }, { $set: fill });
    } catch (err) {
      // Another contact in this business already owns that email/phone: keep records separate.
      if (!isDuplicateKey(err)) throw err;
      return existing.toObject();
    }
    return { ...existing.toObject(), ...fill } as ContactDoc;
  }
  throw new Error('Could not resolve contact');
}

/** Records explicit grants once per submission (idempotent on submissionKey + purpose). */
export async function recordConsent(
  businessId: Types.ObjectId,
  contactId: Types.ObjectId,
  purposes: ConsentPurpose[],
  businessName: string,
  submissionKey: string,
  now: Date,
) {
  const wording = consentWording(businessName);
  for (const purpose of purposes) {
    try {
      await ConsentEvent.create({
        businessId,
        contactId,
        purpose,
        choice: 'granted',
        wordingVersion: CONSENT_WORDING_VERSION,
        wordingText: wording[purpose],
        source: 'public_form',
        submissionKey,
        capturedAt: now,
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
  }
  const field = (p: ConsentPurpose) =>
    p === 'review_request_sms' ? 'consent.reviewRequestSms' : 'consent.marketingSms';
  await Contact.updateOne(
    { _id: contactId, businessId },
    {
      $max: { lastResponseAt: now, ...Object.fromEntries(purposes.map((p) => [field(p), now])) },
    },
  );
}

export async function touchContact(contactId: Types.ObjectId, now: Date) {
  await Contact.updateOne({ _id: contactId }, { $max: { lastResponseAt: now } });
}

// ---- Private CRM reads -------------------------------------------------------------------------

export const listContactsQuery = z.object({
  ...paginationQuery,
  search: z.string().trim().max(100).optional(),
});

const contactDto = (c: ContactDoc, responseCount: number) => ({
  id: String(c._id),
  fullName: c.fullName,
  email: c.emailLowercase,
  phone: c.phoneE164,
  responseCount,
  firstResponseAt: c.firstResponseAt,
  lastResponseAt: c.lastResponseAt,
  consent: {
    reviewRequestSms: c.consent?.reviewRequestSms ?? null,
    marketingSms: c.consent?.marketingSms ?? null,
  },
});

async function responseCounts(businessId: string, ids: Types.ObjectId[]) {
  const rows = await Response.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { businessId: new Types.ObjectId(businessId), contactId: { $in: ids } } },
    { $group: { _id: '$contactId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

export function contactSearchFilter(search: string): QueryFilter<ContactDoc> {
  const rx = new RegExp(escapeRegex(search), 'i');
  return { $or: [{ fullName: rx }, { emailLowercase: rx }, { phoneE164: rx }] };
}

export async function listContacts(businessId: string, q: z.infer<typeof listContactsQuery>) {
  const filter: QueryFilter<ContactDoc> = {
    businessId: new Types.ObjectId(businessId),
    ...(q.search ? contactSearchFilter(q.search) : {}),
  };
  const [rows, total] = await Promise.all([
    Contact.find(filter)
      .sort({ lastResponseAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    Contact.countDocuments(filter),
  ]);
  const counts = await responseCounts(
    businessId,
    rows.map((r) => r._id),
  );
  return {
    data: rows.map((r) => contactDto(r, counts.get(String(r._id)) ?? 0)),
    pagination: pageMeta(q.page, q.pageSize, total),
  };
}

export async function getContact(businessId: string, contactId: string) {
  if (!OBJECT_ID.test(contactId)) throw notFound('Contact not found');
  const c = await Contact.findOne({ _id: contactId, businessId }).lean();
  if (!c) throw notFound('Contact not found');
  const [responses, consentEvents, total] = await Promise.all([
    Response.find({ businessId, contactId: c._id }).sort({ submittedAt: -1 }).limit(20).lean(),
    ConsentEvent.find({ businessId, contactId: c._id }).sort({ capturedAt: -1 }).limit(50).lean(),
    Response.countDocuments({ businessId, contactId: c._id }),
  ]);
  return {
    contact: contactDto(c, total),
    responses: responses.map((r) => ({
      id: String(r._id),
      submittedAt: r.submittedAt,
      rating: r.rating,
      questionnaireVersion: r.questionnaireVersion,
    })),
    consentEvents: consentEvents.map((e) => ({
      id: String(e._id),
      purpose: e.purpose,
      choice: e.choice,
      wordingVersion: e.wordingVersion,
      wordingText: e.wordingText,
      source: e.source,
      capturedAt: e.capturedAt,
    })),
  };
}
