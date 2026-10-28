import { SupportGrant } from './support.model';

/**
 * Retention defaults are engineering proposals, not legal advice. Counsel must confirm them
 * per jurisdiction and contract before production use (see docs/security/privileged-access.md).
 */
export const RETENTION = {
  /** Grants that never became active held no data access; their request text may be removed. */
  neverActivatedGrantMonths: 12,
  /** Activated grants and every support_access_log entry: kept at least this long, then reviewed. */
  accessEvidenceMonths: 36,
} as const;

const monthsAgo = (months: number, now: Date) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};

export interface RetentionPlan {
  neverActivatedEligible: number;
  accessEvidenceReviewDue: number;
  logPolicy: string;
}

/** Counts only. The application never deletes support_access_log; that needs a DBA and legal hold review. */
export async function planSupportRetention(now = new Date()): Promise<RetentionPlan> {
  const [neverActivatedEligible, accessEvidenceReviewDue] = await Promise.all([
    SupportGrant.countDocuments({
      approvedAt: null,
      status: { $in: ['denied', 'cancelled', 'pending'] },
      updatedAt: { $lt: monthsAgo(RETENTION.neverActivatedGrantMonths, now) },
      emergency: { $ne: true },
    }),
    SupportGrant.countDocuments({
      approvedAt: { $ne: null },
      updatedAt: { $lt: monthsAgo(RETENTION.accessEvidenceMonths, now) },
    }),
  ]);
  return {
    neverActivatedEligible,
    accessEvidenceReviewDue,
    logPolicy:
      'support_access_log is append-only and never deleted by the application; purge only via a DBA-run, legally approved process.',
  };
}

/** Removes only grants that never opened access; their audit trail stays in the access log. */
export async function purgeNeverActivatedGrants(now = new Date()) {
  const res = await SupportGrant.deleteMany({
    approvedAt: null,
    status: { $in: ['denied', 'cancelled', 'pending'] },
    updatedAt: { $lt: monthsAgo(RETENTION.neverActivatedGrantMonths, now) },
    emergency: { $ne: true },
  });
  return res.deletedCount;
}

type Privilege = { resource: { db?: string; collection?: string }; actions: string[] };
const FORBIDDEN_ON_AUDIT = [
  'update',
  'remove',
  'dropCollection',
  'renameCollectionSameDB',
  'collMod',
  'dropIndex',
];

/** Pure check over `connectionStatus({showPrivileges:true})` output. */
export function evaluateAuditPrivileges(privileges: Privilege[], database: string) {
  const findings: string[] = [];
  for (const collection of ['support_access_log']) {
    const granted = new Set<string>();
    for (const p of privileges) {
      const db = p.resource.db ?? '';
      const col = p.resource.collection ?? '';
      const covers = (db === database || db === '') && (col === collection || col === '');
      if (covers) p.actions.forEach((a) => granted.add(a));
    }
    for (const a of FORBIDDEN_ON_AUDIT)
      if (granted.has(a))
        findings.push(
          `Application role can '${a}' on ${collection}; remove it (insert/find only).`,
        );
    if (!granted.has('insert')) findings.push(`Application role cannot insert into ${collection}.`);
  }
  return findings;
}
