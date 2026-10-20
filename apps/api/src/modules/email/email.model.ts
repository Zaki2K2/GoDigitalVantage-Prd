import { Schema, model } from 'mongoose';
import { applyMarketingReceipt } from '../campaigns/campaign.marketing';
const schema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    providerMessageId: { type: String, required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: [
        'email.delivered',
        'email.failed',
        'email.bounced',
        'email.complained',
        'email.suppressed',
      ],
    },
    occurredAt: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { collection: 'email_delivery_events' },
);
export const EmailDeliveryEvent = model('EmailDeliveryEvent', schema);
export async function recordEmailReceipt(
  eventId: string,
  providerMessageId: string,
  type: string,
  occurredAt: Date,
) {
  try {
    await EmailDeliveryEvent.updateOne(
      { eventId },
      { $setOnInsert: { eventId, providerMessageId, type, occurredAt, receivedAt: new Date() } },
      { upsert: true, runValidators: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  await applyMarketingReceipt(providerMessageId, type);
}
