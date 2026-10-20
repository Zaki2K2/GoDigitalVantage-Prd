import { Schema, model, type Types } from 'mongoose';

/** What a customer can agree to. Submitting feedback never implies either. */
export const CONSENT_PURPOSES = ['review_request_sms', 'marketing_sms'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export interface ContactDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  fullName: string | null;
  emailLowercase: string | null;
  phoneE164: string | null;
  birthday: string | null;
  anniversary: string | null;
  tags: string[];
  segment: string | null;
  loyaltyLevel: string | null;
  firstResponseAt: Date;
  lastResponseAt: Date;
  /** Latest grant time per purpose (null = never granted). Source of truth: consent_events. */
  consent: { reviewRequestSms: Date | null; marketingSms: Date | null };
  createdAt: Date;
  updatedAt: Date;
}

const contactSchema = new Schema<ContactDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    fullName: { type: String, default: null },
    emailLowercase: { type: String, default: null },
    phoneE164: { type: String, default: null },
    birthday: { type: String, default: null },
    anniversary: { type: String, default: null },
    tags: { type: [String], default: [] },
    segment: { type: String, default: null },
    loyaltyLevel: { type: String, default: null },
    firstResponseAt: { type: Date, required: true },
    lastResponseAt: { type: Date, required: true },
    consent: {
      reviewRequestSms: { type: Date, default: null },
      marketingSms: { type: Date, default: null },
    },
  },
  { timestamps: true, collection: 'contacts' },
);
// A phone / email identifies one contact *within a business*; never across tenants.
contactSchema.index(
  { businessId: 1, phoneE164: 1 },
  { unique: true, partialFilterExpression: { phoneE164: { $type: 'string' } } },
);
contactSchema.index(
  { businessId: 1, emailLowercase: 1 },
  { unique: true, partialFilterExpression: { emailLowercase: { $type: 'string' } } },
);
contactSchema.index({ businessId: 1, lastResponseAt: -1 });
contactSchema.index({ businessId: 1, birthday: 1, _id: 1 });
contactSchema.index({ businessId: 1, anniversary: 1, _id: 1 });
contactSchema.index({ businessId: 1, tags: 1, _id: 1 });
contactSchema.index({ businessId: 1, segment: 1, _id: 1 });

contactSchema.index({ createdAt: -1, _id: -1 });
export const Contact = model<ContactDoc>('Contact', contactSchema);

export interface ConsentEventDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  contactId: Types.ObjectId;
  purpose: ConsentPurpose;
  choice: 'granted';
  wordingVersion: string;
  wordingText: string;
  source: 'public_form';
  /** Submission idempotency key: makes recording a grant idempotent. */
  submissionKey: string;
  capturedAt: Date;
}

/** Insert-only audit trail of explicit consent. */
const consentSchema = new Schema<ConsentEventDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    purpose: { type: String, enum: CONSENT_PURPOSES, required: true },
    choice: { type: String, enum: ['granted'], required: true },
    wordingVersion: { type: String, required: true },
    wordingText: { type: String, required: true },
    source: { type: String, enum: ['public_form'], required: true },
    submissionKey: { type: String, required: true },
    capturedAt: { type: Date, required: true },
  },
  { collection: 'consent_events' },
);
consentSchema.index({ businessId: 1, contactId: 1, capturedAt: -1 });
consentSchema.index({ businessId: 1, submissionKey: 1, purpose: 1 }, { unique: true });

export const ConsentEvent = model<ConsentEventDoc>('ConsentEvent', consentSchema);
