import { z } from 'zod';
import mongoose, { Types } from 'mongoose';
import { AdminAudit } from './admin.model';
import type { ListQuery } from './admin.schemas';
import { escapeRegex, OBJECT_ID, pageMeta } from '../../shared/pagination';
import { notFound } from '../../shared/errors';

// Inclusion projections are deliberate: new model fields are private until explicitly reviewed here.
export const resources = {
  businesses: {
    collection: 'businesses',
    fields:
      'name category email phone address timezone googleReviewUrl slug status adminState ownerUserId onboarding createdAt updatedAt',
    search: ['name', 'email'],
    date: 'createdAt',
  },
  users: {
    collection: 'users',
    fields: 'fullName emailLowercase status platformRole permissions createdAt updatedAt',
    search: ['fullName', 'emailLowercase'],
    date: 'createdAt',
  },
  forms: {
    collection: 'questionnaires',
    fields:
      'businessId adminArchived draft draftRevision publishedRevision publishedVersion createdAt updatedAt',
    search: ['draft.title'],
    date: 'createdAt',
  },
  responses: {
    collection: 'responses',
    fields:
      'businessId questionnaireId questionnaireVersion contactId answers rating consentSnapshot submittedAt',
    search: ['answers.text', 'answers.label'],
    date: 'submittedAt',
  },
  contacts: {
    collection: 'contacts',
    fields:
      'businessId fullName emailLowercase phoneE164 consent firstResponseAt lastResponseAt createdAt updatedAt',
    search: ['fullName', 'emailLowercase', 'phoneE164'],
    date: 'createdAt',
  },
  promotions: {
    collection: 'rewards',
    fields:
      'businessId ruleId ruleName incidentId responseId contactId code status discountType discountValue currency minSpend maxDiscount terms issuedAt expiresAt decisionNote deliveries redemption createdAt updatedAt',
    search: ['code', 'ruleName'],
    date: 'createdAt',
  },
  activity: {
    collection: 'admin_audit',
    fields:
      'actorUserId actorName actorEmail actorRole businessId entity targetId action before after outcome at',
    search: ['actorName', 'actorEmail', 'action'],
    date: 'at',
  },
} as const;
export type Resource = keyof typeof resources;
export function projection(resource: Resource) {
  return Object.fromEntries(resources[resource].fields.split(' ').map((field) => [field, 1]));
}
export async function list(resource: Resource, q: ListQuery) {
  const config = resources[resource];
  const match: Record<string, unknown> = {};
  if (q.businessId)
    match[resource === 'businesses' ? '_id' : 'businessId'] = new Types.ObjectId(q.businessId);
  if (q.actorUserId && resource === 'activity')
    match['actorUserId'] = new Types.ObjectId(q.actorUserId);
  if (q.action && resource === 'activity') match['action'] = q.action;
  if (q.entity && resource === 'activity') match['entity'] = q.entity;
  if (q.questionnaireId && resource === 'responses')
    match['questionnaireId'] = new Types.ObjectId(q.questionnaireId);
  if (q.rating && resource === 'responses') match['rating'] = q.rating;
  if (q.role && resource === 'users') {
    if (q.role === 'owner' || q.role === 'member') {
      // Distinct membership ids remain inside MongoDB; no platform-sized $in arrays.
      match['membershipRoles.role'] = q.role;
    } else match['platformRole'] = q.role === 'USER' ? { $in: ['USER', null] } : q.role;
  }
  if (q.onboarding && resource === 'businesses')
    match['onboarding.completedAt'] = q.onboarding === 'complete' ? { $ne: null } : null;
  if (q.status) {
    const allowed: Partial<Record<Resource, readonly string[]>> = {
      businesses: ['active', 'onboarding', 'disabled', 'suspended', 'archived'],
      users: ['active', 'disabled'],
      forms: ['draft', 'published', 'archived'],
      promotions: ['pending_approval', 'issued', 'redeemed', 'expired', 'cancelled', 'rejected'],
    };
    z.string()
      .refine((value) => allowed[resource]?.includes(value) ?? false, 'Unsupported status filter')
      .parse(q.status);
    if (resource === 'businesses') {
      if (['suspended', 'archived'].includes(q.status)) match['adminState'] = q.status;
      else {
        match['status'] = q.status;
        match['adminState'] = { $nin: ['suspended', 'archived'] };
      }
    } else if (resource === 'forms') {
      if (q.status === 'archived') match['adminArchived'] = true;
      else {
        match['adminArchived'] = { $ne: true };
        match['publishedVersion'] = q.status === 'published' ? { $gt: 0 } : 0;
      }
    } else if (resource === 'promotions' && q.status === 'expired') {
      match['status'] = 'issued';
      match['expiresAt'] = { $lte: new Date() };
    } else if (resource === 'promotions' && q.status === 'issued') {
      match['status'] = 'issued';
      match['$or'] = [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }];
    } else match['status'] = q.status;
  }
  if (q.from || q.to)
    match[config.date] = {
      ...(q.from ? { $gte: new Date(q.from) } : {}),
      ...(q.to ? { $lte: new Date(q.to) } : {}),
    };
  const pipeline: mongoose.PipelineStage[] = [];
  if (resource === 'users' && (q.role === 'owner' || q.role === 'member'))
    pipeline.push({
      $lookup: {
        from: 'business_memberships',
        localField: '_id',
        foreignField: 'userId',
        as: 'membershipRoles',
        pipeline: [{ $match: { role: q.role } }, { $limit: 1 }, { $project: { role: 1 } }],
      },
    });
  if (q.search) {
    const regex = { $regex: escapeRegex(q.search), $options: 'i' };
    const clauses: Record<string, unknown>[] = config.search.map((field) => ({ [field]: regex }));
    if (OBJECT_ID.test(q.search)) clauses.push({ _id: new Types.ObjectId(q.search) });
    if (resource === 'businesses') {
      pipeline.push({
        $lookup: {
          from: 'users',
          localField: 'ownerUserId',
          foreignField: '_id',
          as: 'owner',
          pipeline: [{ $project: { fullName: 1, emailLowercase: 1 } }],
        },
      });
      clauses.push({ 'owner.fullName': regex }, { 'owner.emailLowercase': regex });
    } else if (resource !== 'users' && resource !== 'activity') {
      pipeline.push({
        $lookup: {
          from: 'businesses',
          localField: 'businessId',
          foreignField: '_id',
          as: 'business',
          pipeline: [{ $project: { name: 1 } }],
        },
      });
      clauses.push({ 'business.name': regex });
    }
    match['$and'] = [{ $or: clauses }];
  }
  const sort = ['name', 'fullName', 'updatedAt'].includes(q.sort) ? q.sort : config.date;
  pipeline.push(
    { $match: match },
    { $sort: { [sort]: q.direction === 'asc' ? 1 : -1, _id: -1 } },
    {
      $facet: {
        items: [
          { $skip: (q.page - 1) * q.pageSize },
          { $limit: q.pageSize },
          { $project: projection(resource) },
        ],
        count: [{ $count: 'total' }],
      },
    },
  );
  const [result] = await mongoose.connection
    .collection(config.collection)
    .aggregate(pipeline)
    .toArray();
  const items = result?.['items'] ?? [];
  // Enrichment is limited to the current page, never one request per row.
  const businessIds = items.flatMap((item: Record<string, unknown>) =>
    item['businessId'] ? [item['businessId']] : [],
  );
  const ownerIds = items.flatMap((item: Record<string, unknown>) =>
    item['ownerUserId'] ? [item['ownerUserId']] : [],
  );
  const pageIds = items.map((item: Record<string, unknown>) => item['_id']);
  const groupCounts = async (collection: string, field: string) =>
    mongoose.connection
      .collection(collection)
      .aggregate([
        { $match: { [field]: { $in: pageIds } } },
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      ])
      .toArray();
  const countQueries = !pageIds.length
    ? []
    : resource === 'businesses'
      ? ['business_memberships', 'questionnaires', 'responses'].map((name) =>
          groupCounts(name, 'businessId'),
        )
      : resource === 'users'
        ? [groupCounts('business_memberships', 'userId')]
        : resource === 'forms'
          ? [groupCounts('responses', 'questionnaireId')]
          : [];
  // Page enrichment and counts share no dependency; never issue empty $in lookups.
  const [businesses, owners, counts] = await Promise.all([
    businessIds.length
      ? mongoose.connection
          .collection('businesses')
          .find({ _id: { $in: businessIds } }, { projection: { name: 1 } })
          .toArray()
      : Promise.resolve([]),
    ownerIds.length
      ? mongoose.connection
          .collection('users')
          .find({ _id: { $in: ownerIds } }, { projection: { fullName: 1, emailLowercase: 1 } })
          .toArray()
      : Promise.resolve([]),
    Promise.all(countQueries),
  ]);
  const countFor = (group: number, item: Record<string, unknown>) =>
    counts[group]?.find((entry) => String(entry._id) === String(item['_id']))?.['count'] ?? 0;
  const data = items.map((item: Record<string, unknown>) => ({
    ...item,
    ...(resource === 'users'
      ? { platformRole: item['platformRole'] ?? 'USER' }
      : resource === 'businesses'
        ? { adminState: item['adminState'] ?? 'active' }
        : {}),
    ...(resource === 'businesses'
      ? {
          memberCount: countFor(0, item),
          formCount: countFor(1, item),
          responseCount: countFor(2, item),
        }
      : resource === 'users'
        ? { businessCount: countFor(0, item) }
        : resource === 'forms'
          ? { responseCount: countFor(0, item) }
          : {}),
    businessName: businesses.find((b) => String(b._id) === String(item['businessId']))?.['name'],
    owner: owners.find((u) => String(u._id) === String(item['ownerUserId'])),
    ...(resource === 'promotions' &&
    item['status'] === 'issued' &&
    item['expiresAt'] &&
    new Date(String(item['expiresAt'])).getTime() <= Date.now()
      ? { status: 'expired' }
      : {}),
  }));
  return { data, pagination: pageMeta(q.page, q.pageSize, result?.['count']?.[0]?.total ?? 0) };
}
export async function detail(resource: Resource, id: string) {
  const item = await mongoose.connection
    .collection(resources[resource].collection)
    .findOne({ _id: new Types.ObjectId(id) }, { projection: projection(resource) });
  if (!item) throw notFound('Record not found');
  if (resource === 'businesses') {
    const businessId = item._id;
    const names = ['business_memberships', 'questionnaires', 'responses', 'contacts', 'rewards'];
    const [values, owner] = await Promise.all([
      Promise.all(
        names.map((name) => mongoose.connection.collection(name).countDocuments({ businessId })),
      ),
      mongoose.connection
        .collection('users')
        .findOne(
          { _id: item['ownerUserId'] },
          { projection: { fullName: 1, emailLowercase: 1, status: 1 } },
        ),
    ]);
    item['counts'] = Object.fromEntries(names.map((name, index) => [name, values[index]]));
    item['owner'] = owner;
  }
  if (resource === 'users')
    item['businessCount'] = await mongoose.connection
      .collection('business_memberships')
      .countDocuments({ userId: item._id });
  if (resource === 'responses')
    item['promotion'] = await mongoose.connection
      .collection('rewards')
      .findOne(
        { responseId: item._id, businessId: item['businessId'] },
        { projection: projection('promotions') },
      );
  return item;
}
export async function audit(
  actorId: string,
  entity: string,
  targetId: string,
  action: string,
  before: unknown,
  after: unknown,
  businessId?: string,
) {
  const actor = await mongoose.connection
    .collection('users')
    .findOne(
      { _id: new Types.ObjectId(actorId) },
      { projection: { fullName: 1, emailLowercase: 1 } },
    );
  // Write intent before mutation: an audit storage failure prevents the privileged write.
  return AdminAudit.create({
    actorUserId: actorId,
    actorName: actor?.['fullName'],
    actorEmail: actor?.['emailLowercase'],
    entity,
    targetId,
    action,
    before,
    after,
    businessId,
  });
}
export async function memberships(scope: 'business' | 'user', id: string, q: ListQuery) {
  const isBusiness = scope === 'business';
  const related = isBusiness ? 'user' : 'business';
  const match: Record<string, unknown> = {
    [isBusiness ? 'businessId' : 'userId']: new Types.ObjectId(id),
  };
  if (q.from || q.to)
    match['createdAt'] = {
      ...(q.from ? { $gte: new Date(q.from) } : {}),
      ...(q.to ? { $lte: new Date(q.to) } : {}),
    };
  const pipeline: mongoose.PipelineStage[] = [
    { $match: match },
    {
      $lookup: {
        from: isBusiness ? 'users' : 'businesses',
        localField: isBusiness ? 'userId' : 'businessId',
        foreignField: '_id',
        as: related,
        pipeline: [
          {
            $project: isBusiness
              ? { fullName: 1, emailLowercase: 1, status: 1 }
              : { name: 1, adminState: 1, status: 1 },
          },
        ],
      },
    },
  ];
  if (q.search)
    pipeline.push({
      $match: {
        $or: (isBusiness ? ['fullName', 'emailLowercase'] : ['name']).map((field) => ({
          [`${related}.${field}`]: { $regex: escapeRegex(q.search), $options: 'i' },
        })),
      },
    });
  pipeline.push(
    { $sort: { createdAt: q.direction === 'asc' ? 1 : -1, _id: -1 } },
    {
      $facet: {
        items: [
          { $skip: (q.page - 1) * q.pageSize },
          { $limit: q.pageSize },
          {
            $project: { businessId: 1, userId: 1, role: 1, status: 1, createdAt: 1, [related]: 1 },
          },
        ],
        count: [{ $count: 'total' }],
      },
    },
  );
  const [result] = await mongoose.connection
    .collection('business_memberships')
    .aggregate(pipeline)
    .toArray();
  return {
    data: result?.['items'] ?? [],
    pagination: pageMeta(q.page, q.pageSize, result?.['count']?.[0]?.total ?? 0),
  };
}
