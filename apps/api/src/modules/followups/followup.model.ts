import { Schema, model, type Types } from 'mongoose';

export const FOLLOWUP_CHANNELS = ['whatsapp_api', 'click_to_chat'] as const;
export type FollowUpChannel = (typeof FOLLOWUP_CHANNELS)[number];

/** `prepared` = a click-to-chat link was generated; we cannot know whether the owner sent it. */
export const FOLLOWUP_STATUSES = [
  'prepared',
  'sent',
  'delivered',
  'read',
  'failed',
  'received',
] as const;
export type FollowUpStatus = (typeof FOLLOWUP_STATUSES)[number];

export interface FollowUpDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  contactId: Types.ObjectId;
  responseId: Types.ObjectId | null;
  direction: 'outbound' | 'inbound';
  channel: FollowUpChannel;
  body: string;
  /** Set when a pre-approved template was sent instead of free text (outside the 24h window). */
  template: string | null;
  status: FollowUpStatus;
  providerMessageId: string | null;
  errorCode: string | null;
  /** Digits only, as WhatsApp reports numbers. Used to match inbound messages to a tenant. */
  phoneDigits: string;
  sentBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const followUpSchema = new Schema<FollowUpDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    responseId: { type: Schema.Types.ObjectId, ref: 'Response', default: null },
    direction: { type: String, enum: ['outbound', 'inbound'], required: true },
    channel: { type: String, enum: FOLLOWUP_CHANNELS, required: true },
    body: { type: String, required: true, maxlength: 4096 },
    template: { type: String, default: null },
    status: { type: String, enum: FOLLOWUP_STATUSES, required: true },
    providerMessageId: { type: String, default: null },
    errorCode: { type: String, default: null },
    phoneDigits: { type: String, required: true },
    sentBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'followups' },
);
followUpSchema.index({ businessId: 1, contactId: 1, createdAt: -1 });
followUpSchema.index({ businessId: 1, createdAt: -1 });
followUpSchema.index({ phoneDigits: 1, direction: 1, channel: 1, createdAt: -1 });
// Provider ids make webhook retries idempotent.
followUpSchema.index(
  { providerMessageId: 1 },
  { unique: true, partialFilterExpression: { providerMessageId: { $type: 'string' } } },
);

export const FollowUp = model<FollowUpDoc>('FollowUp', followUpSchema);
