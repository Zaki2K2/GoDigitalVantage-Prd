import { Schema, model, type Types } from 'mongoose';

export interface QrEventDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  /** The QR's permanent identifier: the business slug encoded in the printed code. */
  qrId: string;
  eventType: 'scan';
  /** Salted daily hash of IP + user agent; never the raw values. */
  visitorHash: string;
  /** 30-minute window index; with visitorHash it makes repeat page loads count once. */
  windowIndex: number;
  occurredAt: Date;
}

const qrEventSchema = new Schema<QrEventDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    qrId: { type: String, required: true },
    eventType: { type: String, enum: ['scan'], required: true },
    visitorHash: { type: String, required: true },
    windowIndex: { type: Number, required: true },
    occurredAt: { type: Date, required: true },
  },
  { collection: 'qr_events' },
);
qrEventSchema.index(
  { businessId: 1, eventType: 1, visitorHash: 1, windowIndex: 1 },
  { unique: true },
);
qrEventSchema.index({ businessId: 1, occurredAt: -1 });
// Raw scan rows are only needed for recent analytics.
qrEventSchema.index({ occurredAt: 1 }, { expireAfterSeconds: 400 * 24 * 3600 });

export const QrEvent = model<QrEventDoc>('QrEvent', qrEventSchema);
