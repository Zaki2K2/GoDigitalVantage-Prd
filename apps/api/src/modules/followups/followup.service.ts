import { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env';
import { AppError, notFound } from '../../shared/errors';
import { OBJECT_ID, pageMeta, paginationQuery } from '../../shared/pagination';
import { Contact, type ContactDoc } from '../contacts/contact.model';
import { Response } from '../responses/response.model';
import { FollowUp, type FollowUpDoc, type FollowUpStatus } from './followup.model';
import {
  clickToChatLink,
  phoneDigits,
  sendWhatsApp,
  whatsappConfigured,
} from './followup.whatsapp';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const STOP_WORDS = /^\s*(stop|unsubscribe|cancel|end|quit|opt[\s-]?out)\s*[.!]?\s*$/i;

export const sendFollowUpBody = z.object({
  channel: z.enum(['whatsapp_api', 'click_to_chat']),
  message: z.string().trim().min(1).max(1000),
  responseId: z.string().regex(OBJECT_ID).optional(),
  /** Must equal the template name the server reports when free text is not allowed. */
  confirmTemplate: z.string().max(512).optional(),
});
export const listFollowUpsQuery = z.object({
  ...paginationQuery,
  contactId: z.string().regex(OBJECT_ID).optional(),
});

/**
 * A follow-up needs a phone number and the customer's separate, explicit WhatsApp follow-up
 * permission from the feedback form, and no later STOP reply. Review-request and promotional
 * text permissions never authorise it, and submitting feedback alone is never permission.
 */
export function followUpEligibility(
  c: Pick<ContactDoc, 'phoneE164' | 'consent' | 'followUpOptOutAt'>,
) {
  if (!c.phoneE164) return { ok: false as const, reason: 'NO_PHONE' };
  const grantedAt = c.consent?.whatsappFollowUp;
  if (!grantedAt) return { ok: false as const, reason: 'NO_CONSENT' };
  if (c.followUpOptOutAt && c.followUpOptOutAt.getTime() >= grantedAt.getTime())
    return { ok: false as const, reason: 'OPTED_OUT' };
  return { ok: true as const };
}

const REASON_TEXT: Record<string, string> = {
  NO_PHONE: 'This customer did not share a phone number.',
  NO_CONSENT: 'This customer has not given WhatsApp follow-up permission.',
  OPTED_OUT: 'This customer replied STOP. Do not message them unless they opt in again.',
};

const dto = (f: FollowUpDoc) => ({
  id: String(f._id),
  contactId: String(f.contactId),
  responseId: f.responseId ? String(f.responseId) : null,
  direction: f.direction,
  channel: f.channel,
  body: f.body,
  template: f.template,
  status: f.status,
  errorCode: f.errorCode,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});

export const followUpConfig = () => ({
  whatsappApi: whatsappConfigured(),
  clickToChat: true,
});

export async function listFollowUps(businessId: string, q: z.infer<typeof listFollowUpsQuery>) {
  const filter = {
    businessId: new Types.ObjectId(businessId),
    ...(q.contactId ? { contactId: new Types.ObjectId(q.contactId) } : {}),
  };
  const [rows, total] = await Promise.all([
    FollowUp.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    FollowUp.countDocuments(filter),
  ]);
  return { data: rows.map(dto), pagination: pageMeta(q.page, q.pageSize, total) };
}

/** One manual send. Never called by a scheduler: a signed-in owner must click Send. */
export async function sendFollowUp(
  businessId: string,
  contactId: string,
  userId: string,
  input: z.infer<typeof sendFollowUpBody>,
) {
  if (!OBJECT_ID.test(contactId)) throw notFound('Contact not found');
  const contact = await Contact.findOne({ _id: contactId, businessId }).lean();
  if (!contact) throw notFound('Contact not found');
  const eligibility = followUpEligibility(contact);
  if (!eligibility.ok)
    throw new AppError(409, `FOLLOWUP_${eligibility.reason}`, REASON_TEXT[eligibility.reason]!);
  if (input.responseId) {
    // The response must belong to this business and this customer.
    const linked = await Response.exists({ _id: input.responseId, businessId, contactId });
    if (!linked) throw notFound('Response not found');
  }
  const digits = phoneDigits(contact.phoneE164!);
  const base = {
    businessId: contact.businessId,
    contactId: contact._id,
    responseId: input.responseId ? new Types.ObjectId(input.responseId) : null,
    direction: 'outbound' as const,
    channel: input.channel,
    phoneDigits: digits,
    sentBy: new Types.ObjectId(userId),
  };

  if (input.channel === 'click_to_chat') {
    const row = await FollowUp.create({ ...base, body: input.message, status: 'prepared' });
    return { data: dto(row.toObject()), link: clickToChatLink(digits, input.message) };
  }

  if (!whatsappConfigured())
    throw new AppError(
      409,
      'WHATSAPP_NOT_CONFIGURED',
      'WhatsApp Cloud API is not set up. Use the click-to-chat link instead.',
    );
  // Free-form text is only allowed within 24h of the customer's last reply; otherwise a template.
  const lastInbound = await FollowUp.findOne({
    businessId,
    contactId: contact._id,
    direction: 'inbound',
  })
    .sort({ createdAt: -1 })
    .lean();
  const inWindow = !!lastInbound && Date.now() - lastInbound.createdAt.getTime() < WINDOW_MS;
  const template = inWindow ? null : env.WHATSAPP_TEMPLATE_NAME;
  // Never swap the owner's words for a template without an explicit, informed confirmation.
  if (template && input.confirmTemplate !== template)
    throw new AppError(
      409,
      'TEMPLATE_CONFIRMATION_REQUIRED',
      `The customer has not replied in the last 24 hours, so WhatsApp only allows the approved template "${template}". Your message would not be sent.`,
      { template, language: env.WHATSAPP_TEMPLATE_LANGUAGE },
    );
  const result = await sendWhatsApp(digits, template ? { template } : { text: input.message });
  const row = await FollowUp.create({
    ...base,
    body: template
      ? `[Template "${template}" sent. Your typed message was not sent.]`
      : input.message,
    template,
    status: result.ok ? 'sent' : 'failed',
    providerMessageId: result.ok ? result.messageId : null,
    errorCode: result.ok ? null : result.errorCode,
  });
  return { data: dto(row.toObject()), link: null };
}

const RANK: Partial<Record<FollowUpStatus, number>> = { sent: 1, delivered: 2, read: 3 };

const webhookBody = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z.object({
                statuses: z
                  .array(
                    z.object({
                      id: z.string(),
                      status: z.string(),
                      errors: z.array(z.object({ code: z.number().optional() })).optional(),
                    }),
                  )
                  .optional(),
                messages: z
                  .array(
                    z.object({
                      id: z.string(),
                      from: z.string().regex(/^\d{5,20}$/),
                      type: z.string(),
                      context: z.object({ id: z.string().optional() }).optional(),
                      text: z.object({ body: z.string() }).optional(),
                    }),
                  )
                  .optional(),
              }),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const ROUTING_MS = 7 * 24 * 60 * 60 * 1000;
type Thread = { businessId: Types.ObjectId; contactId: Types.ObjectId };

/** Every business/contact pair that has had a WhatsApp message sent to this number. */
async function outboundThreads(from: string): Promise<Thread[]> {
  const rows = await FollowUp.find({
    phoneDigits: from,
    direction: 'outbound',
    channel: 'whatsapp_api',
    status: { $ne: 'failed' },
  })
    .select('businessId contactId')
    .lean();
  const seen = new Map<string, Thread>();
  for (const r of rows)
    seen.set(`${r.businessId}:${r.contactId}`, {
      businessId: r.businessId,
      contactId: r.contactId,
    });
  return [...seen.values()];
}

/**
 * Attributes a reply to one business. Priority: the message it quotes (exact), otherwise the
 * only business that messaged this number recently. The platform shares one WhatsApp number, so
 * when several businesses messaged the same phone and the reply quotes nothing, we do not guess:
 * the text is not stored under any tenant.
 */
async function routeInbound(
  from: string,
  quotedId: string | undefined,
  threads: Thread[],
): Promise<Thread | null> {
  if (quotedId) {
    const quoted = await FollowUp.findOne({
      providerMessageId: quotedId,
      phoneDigits: from,
      direction: 'outbound',
    }).lean();
    if (quoted) return { businessId: quoted.businessId, contactId: quoted.contactId };
  }
  const recent = await FollowUp.find({
    phoneDigits: from,
    direction: 'outbound',
    channel: 'whatsapp_api',
    status: { $ne: 'failed' },
    createdAt: { $gt: new Date(Date.now() - ROUTING_MS) },
  })
    .select('businessId contactId')
    .lean();
  const pairs = new Set(recent.map((r) => `${r.businessId}:${r.contactId}`));
  if (pairs.size !== 1) return null;
  const only = recent[0]!;
  return threads.find((t) => String(t.contactId) === String(only.contactId)) ?? null;
}

/** Applies Meta delivery statuses and customer replies. Input is already signature-verified. */
export async function handleWhatsAppWebhook(payload: unknown) {
  const parsed = webhookBody.safeParse(payload);
  if (!parsed.success) return;
  for (const change of parsed.data.entry.flatMap((e) => e.changes)) {
    for (const s of change.value.statuses ?? []) {
      const next = s.status as FollowUpStatus;
      const row = await FollowUp.findOne({ providerMessageId: s.id, direction: 'outbound' });
      if (!row) continue;
      if (next === 'failed' && (RANK[row.status] ?? 0) < 3) {
        row.status = 'failed';
        row.errorCode = `meta_${s.errors?.[0]?.code ?? 'unknown'}`;
        await row.save();
      } else if ((RANK[next] ?? 0) > (RANK[row.status] ?? 0)) {
        // Statuses can arrive out of order; never move backwards.
        row.status = next;
        await row.save();
      }
    }
    for (const m of change.value.messages ?? []) {
      const text =
        m.type === 'text' && m.text ? m.text.body.slice(0, 1000) : '[Unsupported message type]';
      const threads = await outboundThreads(m.from);
      const route = await routeInbound(m.from, m.context?.id, threads);
      if (route) {
        try {
          await FollowUp.create({
            businessId: route.businessId,
            contactId: route.contactId,
            responseId: null,
            direction: 'inbound',
            channel: 'whatsapp_api',
            body: text,
            status: 'received',
            providerMessageId: m.id,
            phoneDigits: m.from,
          });
        } catch (err) {
          if ((err as { code?: number }).code === 11000) continue; // webhook retry
          throw err;
        }
      }
      // STOP is honoured for every business that messaged this number, even when the reply
      // cannot be attributed to one thread: opting out must never depend on routing.
      if (STOP_WORDS.test(text))
        for (const t of threads)
          await Contact.updateOne(
            { _id: t.contactId, businessId: t.businessId },
            { $set: { followUpOptOutAt: new Date() } },
          );
    }
  }
}
