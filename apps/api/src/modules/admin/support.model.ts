import { Schema, model } from 'mongoose';

export const SUPPORT_SCOPES = [
  'business_profile',
  'forms',
  'responses',
  'contacts',
  'rewards',
  'campaigns',
] as const;
export type SupportScope = (typeof SUPPORT_SCOPES)[number];
export const SUPPORT_MODES = ['read', 'write'] as const;
export type SupportMode = (typeof SUPPORT_MODES)[number];

/** Time-boxed, owner-approved (or emergency) access. Never a credential: it only gates API checks. */
const grantSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    ticketRef: { type: String, required: true, maxlength: 80 },
    reason: { type: String, required: true, maxlength: 1000 },
    scopes: { type: [{ type: String, enum: SUPPORT_SCOPES }], required: true },
    mode: { type: String, enum: SUPPORT_MODES, default: 'read' },
    durationMinutes: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'denied', 'revoked', 'cancelled'],
      default: 'pending',
    },
    requestExpiresAt: { type: Date, required: true },
    approvedBy: { type: Schema.Types.ObjectId, default: null },
    approvedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    emergency: { type: Boolean, default: false },
    review: {
      status: { type: String, enum: ['not_required', 'pending', 'accepted', 'escalated'] },
      reviewedBy: { type: Schema.Types.ObjectId, default: null },
      reviewedAt: { type: Date, default: null },
      notes: { type: String, default: null, maxlength: 1000 },
    },
  },
  { timestamps: true, collection: 'support_grants' },
);
grantSchema.index({ businessId: 1, status: 1, expiresAt: 1 });
grantSchema.index({ requestedBy: 1, createdAt: -1 });
grantSchema.index({ emergency: 1, 'review.status': 1 });
export const SupportGrant = model('SupportGrant', grantSchema);

/** Short-lived proof that the administrator re-entered their password. */
const reauthSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    sessionVersion: { type: Number, default: 0 },
    /** Refresh-token family of the login that proved the password; never valid elsewhere. */
    sessionId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'admin_reauth' },
);
reauthSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
reauthSchema.index({ userId: 1 });
export const AdminReauth = model('AdminReauth', reauthSchema);

/**
 * Append-only record of every support-access decision, allowed or denied.
 * It stores identifiers and codes only: never request bodies, query strings or customer data.
 */
const logSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    actorUserId: { type: Schema.Types.ObjectId, required: true },
    actorRole: { type: String, default: 'USER' },
    businessId: { type: Schema.Types.ObjectId, default: null },
    grantId: { type: Schema.Types.ObjectId, default: null },
    event: { type: String, required: true },
    outcome: { type: String, enum: ['allowed', 'denied'], required: true },
    reason: { type: String, default: null, maxlength: 80 },
    scope: { type: String, default: null },
    operation: { type: String, default: null },
    route: { type: String, default: null, maxlength: 120 },
    ticketRef: { type: String, default: null, maxlength: 80 },
  },
  { collection: 'support_access_log', strict: true },
);
const immutable = () => {
  throw new Error('Support access records are immutable');
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const)
  logSchema.pre(op, immutable);
logSchema.pre('save', function () {
  if (!this.isNew) throw new Error('Support access records are immutable');
});
logSchema.index({ at: -1, _id: -1 });
logSchema.index({ businessId: 1, at: -1 });
logSchema.index({ grantId: 1, at: -1 });
export const SupportAccessLog = model('SupportAccessLog', logSchema);
