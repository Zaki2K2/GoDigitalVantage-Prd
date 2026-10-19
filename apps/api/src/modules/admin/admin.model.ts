import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, required: true },
    actorName: { type: String, required: true },
    actorEmail: { type: String, required: true },
    actorRole: { type: String, default: 'SUPER_ADMIN' },
    businessId: { type: Schema.Types.ObjectId, default: null },
    entity: { type: String, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    outcome: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    at: { type: Date, default: Date.now },
  },
  { collection: 'admin_audit' },
);
schema.index({ at: -1, _id: -1 });
schema.index({ businessId: 1, at: -1 });
schema.index({ actorUserId: 1, at: -1 });
export const AdminAudit = model('AdminAudit', schema);
