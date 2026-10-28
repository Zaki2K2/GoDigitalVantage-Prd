import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  evaluateAuditPrivileges,
  planSupportRetention,
  purgeNeverActivatedGrants,
} from '../src/modules/admin/support-retention';
import { SupportAccessLog, SupportGrant } from '../src/modules/admin/support.model';

beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
});
afterAll(async () => {
  await mongoose.disconnect();
});
beforeEach(async () => {
  await SupportGrant.deleteMany({});
  await mongoose.connection.collection('support_access_log').deleteMany({});
});

const grant = (over: Record<string, unknown>) => {
  const id = new mongoose.Types.ObjectId();
  return {
    businessId: id,
    requestedBy: id,
    ticketRef: 'T-1',
    reason: 'Retention fixture reason',
    scopes: ['responses'],
    durationMinutes: 60,
    requestExpiresAt: new Date(),
    ...over,
  };
};
const old = (months: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

describe('support retention', () => {
  it('purges only old never-activated grants and leaves evidence and the log alone', async () => {
    const [stale, recent, used, emergency] = await SupportGrant.insertMany([
      grant({ status: 'denied' }),
      grant({ status: 'denied' }),
      grant({ status: 'revoked', approvedAt: new Date(), expiresAt: new Date() }),
      grant({ status: 'cancelled', emergency: true }),
    ]);
    // Backdate through the driver: timestamps are otherwise managed by Mongoose.
    await SupportGrant.collection.updateMany(
      { _id: { $in: [stale!._id, used!._id, emergency!._id] } },
      { $set: { updatedAt: old(40) } },
    );
    await SupportAccessLog.create({
      actorUserId: new mongoose.Types.ObjectId(),
      event: 'GRANT_REQUESTED',
      outcome: 'allowed',
    });

    const plan = await planSupportRetention();
    expect(plan.neverActivatedEligible).toBe(1);
    expect(plan.accessEvidenceReviewDue).toBe(1);
    expect(await purgeNeverActivatedGrants()).toBe(1);
    expect(await SupportGrant.exists({ _id: stale!._id })).toBeNull();
    for (const kept of [recent, used, emergency])
      expect(await SupportGrant.exists({ _id: kept!._id })).not.toBeNull();
    expect(await SupportAccessLog.countDocuments()).toBe(1);
  });

  it('flags application roles that can alter or drop the append-only log', () => {
    const readOnlyLog = [
      { resource: { db: 'gdv', collection: 'support_access_log' }, actions: ['insert', 'find'] },
    ];
    expect(evaluateAuditPrivileges(readOnlyLog, 'gdv')).toEqual([]);
    const broad = [
      { resource: { db: 'gdv', collection: '' }, actions: ['insert', 'update', 'remove'] },
    ];
    const findings = evaluateAuditPrivileges(broad, 'gdv').join(' ');
    expect(findings).toContain("'update'");
    expect(findings).toContain("'remove'");
    expect(evaluateAuditPrivileges([], 'gdv').join(' ')).toContain('cannot insert');
  });
});
