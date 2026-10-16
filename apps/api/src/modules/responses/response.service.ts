import { Types, type QueryFilter } from 'mongoose';
import { notFound } from '../../shared/errors';
import { escapeRegex, OBJECT_ID, pageMeta } from '../../shared/pagination';
import { Contact, type ContactDoc } from '../contacts/contact.model';
import { contactSearchFilter } from '../contacts/contact.service';
import { Response, type ResponseDoc } from './response.model';
import type { ListResponsesQuery } from './response.schemas';

type ContactBrief = {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
};

const brief = (
  c: Pick<ContactDoc, '_id' | 'fullName' | 'emailLowercase' | 'phoneE164'>,
): ContactBrief => ({
  id: String(c._id),
  fullName: c.fullName,
  email: c.emailLowercase,
  phone: c.phoneE164,
});

async function contactsById(businessId: string, ids: (Types.ObjectId | null)[]) {
  const real = ids.filter((i): i is Types.ObjectId => i !== null);
  const rows = real.length ? await Contact.find({ businessId, _id: { $in: real } }).lean() : [];
  return new Map(rows.map((c) => [String(c._id), brief(c)]));
}

const preview = (r: ResponseDoc) => {
  const pick =
    r.answers.find((a) => a.type === 'long_text' && a.text) ?? r.answers.find((a) => a.text);
  const t = pick?.text ?? null;
  return t && t.length > 140 ? `${t.slice(0, 140)}…` : t;
};

const listItem = (r: ResponseDoc, contacts: Map<string, ContactBrief>) => ({
  id: String(r._id),
  submittedAt: r.submittedAt,
  rating: r.rating,
  questionnaireVersion: r.questionnaireVersion,
  preview: preview(r),
  contact: r.contactId ? (contacts.get(String(r.contactId)) ?? null) : null,
});

export async function listResponses(businessId: string, q: ListResponsesQuery) {
  const bid = new Types.ObjectId(businessId);
  const filter: QueryFilter<ResponseDoc> = { businessId: bid };
  if (q.rating) filter.rating = q.rating;
  if (q.version) filter.questionnaireVersion = q.version;
  if (q.contact === 'anonymous') filter.contactId = null;
  if (q.contact === 'identified') filter.contactId = { $ne: null };
  if (q.from || q.to) {
    filter.submittedAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    const matching = await Contact.find(
      { businessId: bid, ...contactSearchFilter(q.search) },
      { _id: 1 },
    ).lean();
    filter.$or = [
      { 'answers.text': rx },
      { 'answers.choices.label': rx },
      ...(matching.length ? [{ contactId: { $in: matching.map((c) => c._id) } }] : []),
    ];
  }
  const [rows, total] = await Promise.all([
    Response.find(filter)
      .sort({ submittedAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    Response.countDocuments(filter),
  ]);
  const contacts = await contactsById(
    businessId,
    rows.map((r) => r.contactId),
  );
  return {
    data: rows.map((r) => listItem(r, contacts)),
    pagination: pageMeta(q.page, q.pageSize, total),
  };
}

export async function getResponse(businessId: string, responseId: string) {
  if (!OBJECT_ID.test(responseId)) throw notFound('Response not found');
  const r = await Response.findOne({ _id: responseId, businessId }).lean();
  if (!r) throw notFound('Response not found');
  const contacts = await contactsById(businessId, [r.contactId]);
  return {
    ...listItem(r, contacts),
    answers: r.answers,
    consent: r.consentSnapshot,
  };
}

/** Latest responses for the dashboard. */
export async function recentResponses(businessId: string, limit: number) {
  const rows = await Response.find({ businessId })
    .sort({ submittedAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  const contacts = await contactsById(
    businessId,
    rows.map((r) => r.contactId),
  );
  return rows.map((r) => listItem(r, contacts));
}
