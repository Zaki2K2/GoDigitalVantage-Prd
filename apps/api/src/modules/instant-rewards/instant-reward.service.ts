import { EmailDeliveryEvent } from '../email/email.model';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError, notFound } from '../../shared/errors';
import { pageMeta, escapeRegex } from '../../shared/pagination';
import { User, type UserDoc } from '../auth/user.model';
import { Business } from '../businesses/business.model';
import {
  InstantReward,
  InstantRewardEvent,
  type InstantRewardDoc,
  type RewardEvent,
} from './instant-reward.model';
import {
  effectiveStatus,
  assertAvailable,
  adminTransition,
  canClaimReward,
  fail,
} from './instant-reward.domain';
import {
  deriveToken,
  tokenHash,
  rewardEmail,
  resendMailer,
  type RewardMailer,
} from './instant-reward.email';
import { type CreateInstantReward, rewardListSchema } from './instant-reward.schemas';

type Actor = { id: string; type: 'ADMIN' | 'USER' };
type ListQuery = z.infer<typeof rewardListSchema>;
const oid = (value: string) => new Types.ObjectId(value);
const event = (
  rewardId: Types.ObjectId | null,
  action: string,
  actor: Actor | null,
  metadata: Record<string, unknown> = {},
  id: string = randomUUID(),
): RewardEvent => ({
  id,
  rewardId,
  action,
  actorId: actor ? oid(actor.id) : null,
  actorType:
    actor?.type ?? (['EMAIL_DELIVERED', 'EMAIL_FAILED'].includes(action) ? 'PROVIDER' : 'SYSTEM'),
  timestamp: new Date(),
  metadata,
});
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object' && !(value instanceof Date)
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
export class InstantRewardsService {
  constructor(private readonly mailer: RewardMailer = resendMailer) {}
  async flush(reward: InstantRewardDoc) {
    const events = reward.pendingEvents as unknown as RewardEvent[];
    if (!events.length) return;
    try {
      await InstantRewardEvent.bulkWrite(
        events.map((item) => ({
          updateOne: { filter: { id: item.id }, update: { $setOnInsert: item }, upsert: true },
        })),
      );
      await InstantReward.updateOne(
        { _id: reward._id },
        { $pull: { pendingEvents: { id: { $in: events.map((item) => item.id) } } } },
      );
    } catch {
      console.warn('Instant reward audit delivery deferred; events remain in durable outbox');
    }
  }
  private async attempt(
    rewardId: Types.ObjectId | null,
    actor: Actor,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    await InstantRewardEvent.create(event(rewardId, action, actor, metadata));
  }
  private async raw(id: string) {
    const r = await InstantReward.findById(id).lean();
    if (!r) fail('REWARD_NOT_FOUND', 'Instant Reward not found', 404);
    return r;
  }
  private async change(
    id: string,
    actor: Actor | null,
    action: string,
    build: (r: InstantRewardDoc) => {
      set?: Record<string, unknown>;
      unset?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    },
    eventId?: string,
  ) {
    for (let retry = 0; retry < 8; retry++) {
      const r = await this.raw(id);
      const { set = {}, unset = {}, metadata = {} } = build(r);
      const updated = await InstantReward.findOneAndUpdate(
        { _id: r._id, revision: r.revision },
        {
          $set: set,
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
          $inc: { revision: 1 },
          $push: { pendingEvents: event(r._id, action, actor, metadata, eventId) },
        },
        { returnDocument: 'after', runValidators: true },
      ).lean();
      if (updated) {
        await this.flush(updated);
        return updated;
      }
    }
    fail('REWARD_REVISION_CONFLICT', 'The reward changed. Refresh and retry.');
  }
  async expire(id?: string) {
    const due = await InstantReward.find({
      ...(id ? { _id: oid(id) } : {}),
      status: { $nin: ['CLAIMED', 'REVOKED', 'EXPIRED'] },
      expiresAt: { $lte: new Date() },
    })
      .sort({ expiresAt: 1 })
      .limit(id ? 1 : 100)
      .lean();
    for (const r of due) {
      const updated = await InstantReward.findOneAndUpdate(
        {
          _id: r._id,
          revision: r.revision,
          status: { $nin: ['CLAIMED', 'REVOKED', 'EXPIRED'] },
          expiresAt: { $lte: new Date() },
        },
        {
          $set: { status: 'EXPIRED' },
          $inc: { revision: 1 },
          $push: { pendingEvents: event(r._id, 'REWARD_EXPIRED', null) },
        },
        { returnDocument: 'after' },
      ).lean();
      if (updated) await this.flush(updated);
    }
  }
  async get(id: string) {
    await this.expire(id);
    const r = await this.raw(id);
    await this.flush(r);
    await this.reconcileReceipts(r);
    return this.raw(id);
  }
  private async reconcileReceipts(r: InstantRewardDoc) {
    const ids = [r.delivery?.providerMessageId, r.verificationDelivery?.providerMessageId].filter(
      (id): id is string => !!id,
    );
    if (!ids.length) return;
    const receipts = await EmailDeliveryEvent.find({ providerMessageId: { $in: ids } })
      .sort({ occurredAt: 1 })
      .limit(100)
      .lean();
    for (const receipt of receipts)
      await this.deliveryEvent(
        receipt.providerMessageId,
        receipt.type,
        receipt.eventId,
        receipt.occurredAt,
      );
  }
  private async account(userId: string) {
    const user = await User.findById(userId).lean();
    if (!user || user.status !== 'active')
      throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'Account unavailable');
    return user;
  }
  private owner(r: InstantRewardDoc, user: UserDoc) {
    if (
      user.emailLowercase !== r.recipientEmail ||
      (r.recipientUserId && String(r.recipientUserId) !== String(user._id))
    )
      fail('REWARD_NOT_OWNER', 'This reward belongs to another recipient', 403);
  }
  dto(r: InstantRewardDoc, admin = false, userId?: string, hasToken = false) {
    const status = effectiveStatus(r);
    const proof =
      !!userId && String(r.verifiedBy) === userId && r.verifiedEmail === r.recipientEmail;
    const actions: string[] = [];
    if (admin) {
      if (!['CLAIMED', 'REVOKED'].includes(status)) {
        if (status === 'DISABLED') actions.push('enable');
        else if (status !== 'EXPIRED') {
          actions.push(r.delivery ? 'resend' : 'send', 'disable');
          if (!r.delivery && status === 'DRAFT') actions.push('edit');
        }
        actions.push('revoke');
      }
    } else if (['SENT', 'DELIVERED', 'VERIFIED'].includes(status)) {
      actions.push('request-link');
      if (r.verificationRequired && !proof && hasToken) actions.push('request-verification');
      if (canClaimReward(r) && (proof || hasToken)) actions.push('claim');
    }
    return {
      id: String(r._id),
      title: r.title,
      description: r.description,
      rewardType: r.rewardType,
      rewardValue: r.rewardValue,
      currency: r.currency,
      promoCode: admin || status === 'CLAIMED' ? r.promoCode : null,
      ...(admin
        ? {
            metadata: r.metadata,
            businessId: r.businessId,
            recipientUserId: r.recipientUserId,
            recipientEmail: r.recipientEmail,
            createdBy: r.createdBy,
            updatedBy: r.updatedBy,
            revision: r.revision,
          }
        : {}),
      status,
      enabled: !['DISABLED', 'REVOKED', 'EXPIRED'].includes(status),
      verificationRequired: r.verificationRequired,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      expiresAt: r.expiresAt,
      sentAt: r.sentAt,
      lastSentAt: r.lastSentAt,
      deliveredAt: r.deliveredAt,
      verifiedAt: r.verifiedAt,
      claimedAt: r.claimedAt,
      disabledAt: r.disabledAt,
      revokedAt: r.revokedAt,
      revokedBy: admin ? r.revokedBy : undefined,
      revokeReason: admin ? r.revokeReason : undefined,
      claimReceiptId: status === 'CLAIMED' ? r.claimReceiptId : null,
      delivery: r.delivery
        ? {
            state: r.delivery.state,
            errorCode: r.delivery.errorCode ?? null,
            ...(admin ? { requestId: r.delivery.requestId, startedAt: r.delivery.startedAt } : {}),
          }
        : null,
      verificationDelivery: r.verificationDelivery
        ? {
            state: r.verificationDelivery.state,
            errorCode: r.verificationDelivery.errorCode ?? null,
          }
        : null,
      allowedActions: actions,
    };
  }
  private async recipient(input: {
    recipientUserId?: string | null;
    recipientEmail?: string;
    businessId?: string | null;
  }) {
    let user: UserDoc | null = null;
    if (input.recipientUserId) {
      user = await User.findById(input.recipientUserId).lean();
      if (!user || user.status !== 'active')
        fail('RECIPIENT_UNAVAILABLE', 'Choose an active recipient account', 422);
      if (input.recipientEmail && input.recipientEmail !== user.emailLowercase)
        fail('RECIPIENT_EMAIL_MISMATCH', 'The email does not match the selected user', 422);
    } else if (input.recipientEmail) {
      user = await User.findOne({ emailLowercase: input.recipientEmail }).lean();
      if (user?.status === 'disabled')
        fail('RECIPIENT_UNAVAILABLE', 'The recipient account is disabled', 422);
    }
    if (input.businessId && !(await Business.exists({ _id: input.businessId })))
      throw notFound('Business not found');
    return {
      recipientEmail: user?.emailLowercase ?? input.recipientEmail!,
      recipientUserId: user?._id ?? null,
      businessId: input.businessId ? oid(input.businessId) : null,
    };
  }
  async create(actor: Actor, input: CreateInstantReward) {
    const { createRequestId, sendImmediately, ...fields } = input;
    const recipient = await this.recipient(fields);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(canonical({ ...input, ...recipient })))
      .digest('hex');
    let r: InstantRewardDoc | null = await InstantReward.findOne({
      createdBy: actor.id,
      createRequestId,
    }).lean();
    let created = false;
    if (!r) {
      const id = new Types.ObjectId();
      try {
        r = (
          await InstantReward.create({
            ...fields,
            ...recipient,
            _id: id,
            createdBy: actor.id,
            updatedBy: actor.id,
            createRequestId,
            createFingerprint: fingerprint,
            pendingEvents: [event(id, 'REWARD_CREATED', actor)],
          })
        ).toObject();
        created = true;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        r = await InstantReward.findOne({ createdBy: actor.id, createRequestId }).lean();
      }
    }
    if (!r) throw new AppError(500, 'REWARD_CREATE_FAILED', 'Reward could not be created');
    if (r.createFingerprint !== fingerprint)
      fail('IDEMPOTENCY_CONFLICT', 'This creation key was used for different reward details');
    await this.flush(r);
    let sendError: string | null = null;
    if (sendImmediately) {
      try {
        r = await this.send(String(r._id), actor, createRequestId);
      } catch (error) {
        sendError = error instanceof AppError ? error.code : 'EMAIL_SEND_UNCERTAIN';
        r = await this.get(String(r._id));
      }
    }
    return { reward: this.dto(r, true), created, sendError };
  }
  async edit(
    id: string,
    actor: Actor,
    input: Omit<CreateInstantReward, 'createRequestId' | 'sendImmediately'> & {
      expectedRevision: number;
    },
  ) {
    const recipient = await this.recipient(input);
    const { expectedRevision, ...fields } = input;
    return this.change(id, actor, 'REWARD_UPDATED', (r) => {
      if (r.status !== 'DRAFT' || r.delivery)
        fail('REWARD_INVALID_STATE', 'Only unsent drafts can be edited');
      if (r.revision !== expectedRevision)
        fail('REWARD_REVISION_CONFLICT', 'Refresh the reward before editing');
      return { set: { ...fields, ...recipient, updatedBy: oid(actor.id) } };
    });
  }
  async action(id: string, actor: Actor, action: 'enable' | 'disable' | 'revoke', reason?: string) {
    await this.expire(id);
    return this.change(
      id,
      actor,
      `REWARD_${action === 'enable' ? 'ENABLED' : action === 'disable' ? 'DISABLED' : 'REVOKED'}`,
      (r) => {
        const status = adminTransition(r, action);
        return {
          set: {
            status,
            updatedBy: oid(actor.id),
            ...(action === 'disable'
              ? { resumeStatus: r.status, disabledAt: new Date() }
              : action === 'revoke'
                ? { revokedAt: new Date(), revokedBy: oid(actor.id), revokeReason: reason ?? null }
                : {}),
          },
          metadata: reason ? { reason } : {},
        };
      },
    );
  }
  private async tokenReward(token: string, purpose: 'claim' | 'verify', allowConsumed = false) {
    const hash = tokenHash(token);
    const r = await InstantReward.findOne(
      purpose === 'verify'
        ? { verificationTokenHash: hash }
        : allowConsumed
          ? { $or: [{ claimTokenHash: hash }, { consumedClaimTokenHash: hash }] }
          : { claimTokenHash: hash },
    ).lean();
    if (!r) fail('INVALID_REWARD_TOKEN', 'This reward link is invalid or already used', 404);
    return r;
  }
  private tokenValid(r: InstantRewardDoc, purpose: 'claim' | 'verify') {
    const expires = purpose === 'claim' ? r.claimTokenExpiresAt : r.verificationTokenExpiresAt;
    if (!expires || expires <= new Date())
      fail('REWARD_TOKEN_EXPIRED', 'This email link has expired. Request a new link.', 410);
  }
  async view(token: string, userId: string) {
    const r = await this.tokenReward(token, 'claim');
    const user = await this.account(userId);
    this.owner(r, user);
    this.tokenValid(r, 'claim');
    assertAvailable(r);
    if (!['SENT', 'DELIVERED', 'VERIFIED'].includes(r.status))
      fail('REWARD_INVALID_STATE', 'This reward is not ready to claim');
    return this.dto(r, false, userId, true);
  }
  async send(id: string, actor: Actor, requestId: string, purpose: 'claim' | 'verify' = 'claim') {
    await this.expire(id);
    let r = await this.raw(id);
    assertAvailable(r);
    const field = purpose === 'claim' ? 'delivery' : 'verificationDelivery';
    if (purpose === 'verify' && r.status === 'VERIFIED') return r;
    let op = r[field];
    if (op?.requestId === requestId) {
      if (op.state === 'ACCEPTED') return this.get(id);
      if (op.state === 'FAILED')
        fail(
          op.errorCode ?? 'EMAIL_SEND_FAILED',
          'Use a new resend operation after this failed delivery',
          503,
        );
      if (!op.startedAt || Date.now() - op.startedAt.getTime() > 20 * 3600000)
        fail(
          'SEND_RECONCILIATION_REQUIRED',
          'Use an explicit resend to rotate this uncertain email link',
        );
    } else {
      const nonce = randomBytes(32).toString('base64url');
      const expires = new Date(
        Math.min(
          r.expiresAt.getTime(),
          Date.now() + (purpose === 'claim' ? 48 * 3600000 : 15 * 60000),
        ),
      );
      let token: string;
      try {
        token = deriveToken(nonce, purpose, requestId);
      } catch (error) {
        await this.attempt(r._id, actor, 'EMAIL_FAILED', { code: 'EMAIL_NOT_CONFIGURED', purpose });
        throw error;
      }
      r = await this.change(
        id,
        actor,
        purpose === 'claim' ? 'EMAIL_REQUESTED' : 'VERIFICATION_REQUESTED',
        (current) => {
          assertAvailable(current);
          if (current[field]?.requestId === requestId)
            return { metadata: { purpose, replayed: true } };
          if (purpose === 'verify' && !['SENT', 'DELIVERED'].includes(current.status))
            fail('REWARD_INVALID_STATE', 'Verification is not available for this reward');
          return {
            set: {
              [field]: {
                requestId,
                nonce,
                tokenExpiresAt: expires,
                state: 'PENDING',
                startedAt: new Date(),
              },
              ...(purpose === 'claim'
                ? {
                    claimTokenHash: tokenHash(token),
                    claimTokenExpiresAt: expires,
                    verificationDelivery: null,
                    ...(current.status === 'FAILED' ? { status: 'DRAFT' } : {}),
                  }
                : { verificationTokenHash: tokenHash(token), verificationTokenExpiresAt: expires }),
              updatedBy: oid(actor.id),
            },
            unset: purpose === 'claim' ? { verificationTokenHash: 1 } : {},
          };
        },
      );
      op = r[field];
      if (op?.state === 'ACCEPTED') return this.get(id);
    }
    if (!op?.nonce || !op.tokenExpiresAt)
      fail('EMAIL_SEND_UNCERTAIN', 'Email operation is incomplete', 503);
    const token = deriveToken(op.nonce, purpose, requestId);
    const stored = purpose === 'claim' ? r.claimTokenHash : r.verificationTokenHash;
    if (tokenHash(token) !== stored)
      fail(
        'SEND_RECONCILIATION_REQUIRED',
        'Email signing configuration changed. Use a new resend.',
      );
    const summary = [
      r.description,
      `Reward expires: ${r.expiresAt.toISOString()}`,
      r.rewardValue !== null
        ? `${r.rewardValue}${r.rewardType === 'PERCENT_DISCOUNT' ? '%' : r.currency ? ' ' + r.currency : ''}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const accepted = await this.mailer.send(
        rewardEmail(
          r.recipientEmail,
          r.title,
          summary,
          op.tokenExpiresAt,
          token,
          purpose === 'verify',
          `instant-${purpose}/${id}/${requestId}`,
          op.startedAt ?? undefined,
        ),
      );
      const sent = await this.change(
        id,
        actor,
        purpose === 'claim' ? 'EMAIL_SENT' : 'VERIFICATION_EMAIL_SENT',
        (current) => {
          if (current[field]?.requestId !== requestId)
            fail('REWARD_REVISION_CONFLICT', 'A newer email link replaced this operation');
          if (current[field]?.state === 'ACCEPTED')
            return { metadata: { purpose, replayed: true } };
          return {
            set: {
              [`${field}.state`]: 'ACCEPTED',
              [`${field}.providerMessageId`]: accepted.id,
              [`${field}.errorCode`]: null,
              ...(purpose === 'claim'
                ? {
                    sentAt: current.sentAt ?? new Date(),
                    lastSentAt: new Date(),
                    ...(['DRAFT', 'FAILED', 'SENT', 'DELIVERED'].includes(current.status)
                      ? { status: 'SENT' }
                      : current.status === 'DISABLED' &&
                          ['DRAFT', 'FAILED'].includes(current.resumeStatus ?? '')
                        ? { resumeStatus: 'SENT' }
                        : {}),
                  }
                : {}),
            },
            metadata: { purpose, providerMessageId: accepted.id },
          };
        },
      );
      await this.reconcileReceipts(sent);
      return this.raw(id);
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'EMAIL_SEND_UNCERTAIN';
      await this.change(id, actor, 'EMAIL_FAILED', (current) => {
        if (current[field]?.requestId !== requestId)
          return { metadata: { code, purpose, obsolete: true } };
        if (current[field]?.state === 'ACCEPTED')
          return { metadata: { code, purpose, accepted: true } };
        const uncertain = code === 'EMAIL_SEND_UNCERTAIN';
        return {
          set: {
            [`${field}.errorCode`]: code,
            [`${field}.state`]: uncertain ? 'PENDING' : 'FAILED',
            ...(purpose === 'claim' &&
            !uncertain &&
            ['DRAFT', 'SENT', 'DELIVERED', 'FAILED'].includes(current.status)
              ? { status: 'FAILED' }
              : {}),
          },
          metadata: { code, purpose },
        };
      });
      throw error instanceof AppError
        ? error
        : new AppError(503, 'EMAIL_SEND_UNCERTAIN', 'Email delivery could not be confirmed');
    }
  }
  async requestLink(id: string, userId: string, requestId: string) {
    const r = await this.get(id);
    const user = await this.account(userId);
    this.owner(r, user);
    assertAvailable(r);
    if (!['SENT', 'DELIVERED', 'VERIFIED'].includes(r.status))
      fail('REWARD_INVALID_STATE', 'Ask the administrator to send this reward first');
    return this.send(id, { id: userId, type: 'USER' }, requestId);
  }
  async requestVerification(token: string, userId: string, requestId: string) {
    const r = await this.tokenReward(token, 'claim');
    const user = await this.account(userId);
    this.owner(r, user);
    this.tokenValid(r, 'claim');
    assertAvailable(r);
    if (!r.verificationRequired)
      fail('REWARD_INVALID_STATE', 'This reward does not require separate verification');
    return this.send(String(r._id), { id: userId, type: 'USER' }, requestId, 'verify');
  }
  async verify(token: string, userId: string) {
    const r = await this.tokenReward(token, 'verify');
    const user = await this.account(userId);
    this.owner(r, user);
    this.tokenValid(r, 'verify');
    assertAvailable(r);
    return this.change(
      String(r._id),
      { id: userId, type: 'USER' },
      'VERIFICATION_COMPLETED',
      (current) => {
        this.owner(current, user);
        assertAvailable(current);
        this.tokenValid(current, 'verify');
        if (current.verificationTokenHash !== tokenHash(token))
          fail('INVALID_REWARD_TOKEN', 'Verification link was already used or replaced', 404);
        if (!['SENT', 'DELIVERED'].includes(current.status))
          fail('REWARD_INVALID_STATE', 'The reward cannot be verified');
        return {
          set: {
            status: 'VERIFIED',
            verifiedAt: new Date(),
            verifiedBy: user._id,
            verifiedEmail: user.emailLowercase,
            recipientUserId: current.recipientUserId ?? user._id,
          },
          unset: { verificationTokenHash: 1 },
        };
      },
    );
  }
  async claim(input: { token?: string; rewardId?: string; requestId: string }, userId: string) {
    const actor: Actor = { id: userId, type: 'USER' };
    let rewardId: Types.ObjectId | null = null;
    try {
      const r = input.token
        ? await this.tokenReward(input.token, 'claim', true)
        : await this.get(input.rewardId!);
      rewardId = r._id;
      const user = await this.account(userId);
      this.owner(r, user);
      await this.attempt(r._id, actor, 'CLAIM_ATTEMPTED');
      const proof = String(r.verifiedBy) === userId && r.verifiedEmail === user.emailLowercase;
      if (r.status === 'CLAIMED') {
        if (r.claimRequestId === input.requestId && String(r.claimedBy) === userId) {
          await this.flush(r);
          return { reward: r, replayed: true };
        }
        fail('REWARD_ALREADY_CLAIMED', 'This reward was already claimed');
      }
      assertAvailable(r);
      if (!proof) {
        if (!input.token || r.claimTokenHash !== tokenHash(input.token))
          fail('INVALID_REWARD_TOKEN', 'Use your emailed reward link', 404);
        this.tokenValid(r, 'claim');
      }
      if (r.verificationRequired && !proof)
        fail(
          'REWARD_VERIFICATION_REQUIRED',
          'Verify ownership of the recipient email before claiming',
        );
      if (!canClaimReward(r)) fail('REWARD_INVALID_STATE', 'This reward cannot be claimed');
      const receipt = randomUUID();
      const now = new Date();
      const updated = await InstantReward.findOneAndUpdate(
        {
          _id: r._id,
          revision: r.revision,
          status: {
            $in: r.verificationRequired ? ['VERIFIED'] : ['SENT', 'DELIVERED', 'VERIFIED'],
          },
          expiresAt: { $gt: now },
          recipientEmail: user.emailLowercase,
          ...(proof
            ? { verifiedBy: user._id, verifiedEmail: user.emailLowercase }
            : { claimTokenHash: tokenHash(input.token!), claimTokenExpiresAt: { $gt: now } }),
        },
        {
          $set: {
            status: 'CLAIMED',
            claimedAt: now,
            claimedBy: user._id,
            recipientUserId: r.recipientUserId ?? user._id,
            claimRequestId: input.requestId,
            claimReceiptId: receipt,
            ...(r.claimTokenHash ? { consumedClaimTokenHash: r.claimTokenHash } : {}),
          },
          $unset: { claimTokenHash: 1, verificationTokenHash: 1 },
          $inc: { revision: 1 },
          $push: { pendingEvents: event(r._id, 'REWARD_CLAIMED', actor, { receiptId: receipt }) },
        },
        { returnDocument: 'after' },
      ).lean();
      if (!updated) {
        const current = await this.get(String(r._id));
        if (
          current.status === 'CLAIMED' &&
          current.claimRequestId === input.requestId &&
          String(current.claimedBy) === userId
        )
          return { reward: current, replayed: true };
        assertAvailable(current);
        fail('REWARD_REVISION_CONFLICT', 'The reward changed. Retry with the same claim request.');
      }
      await this.flush(updated);
      return { reward: updated, replayed: false };
    } catch (error) {
      await this.attempt(rewardId, actor, 'CLAIM_REJECTED', {
        code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
      });
      throw error;
    }
  }
  async list(q: ListQuery, userId?: string) {
    await this.expire();
    const filter: Record<string, unknown> = {};
    if (userId) {
      const user = await this.account(userId);
      filter['recipientEmail'] = user.emailLowercase;
      filter['$or'] = [{ recipientUserId: user._id }, { recipientUserId: null }];
      filter['status'] = { $ne: 'DRAFT' };
    }
    if (q.search)
      filter['$and'] = [
        {
          $or: ['title', 'recipientEmail'].map((key) => ({
            [key]: { $regex: escapeRegex(q.search), $options: 'i' },
          })),
        },
      ];
    if (q.recipientUserId) filter['recipientUserId'] = oid(q.recipientUserId);
    if (q.rewardType) filter['rewardType'] = q.rewardType;
    if (q.from || q.to)
      filter['createdAt'] = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      };
    const now = new Date();
    const restrictions: Record<string, unknown>[] = [];
    if (q.status === 'EXPIRED' || q.group === 'expired')
      restrictions.push({ status: { $nin: ['CLAIMED', 'REVOKED'] }, expiresAt: { $lte: now } });
    else if (q.status)
      restrictions.push({
        status: q.status,
        ...(!['CLAIMED', 'REVOKED'].includes(q.status) ? { expiresAt: { $gt: now } } : {}),
      });
    if (q.group === 'claimed') restrictions.push({ status: 'CLAIMED' });
    if (q.group === 'available')
      restrictions.push({
        status: { $in: ['SENT', 'DELIVERED', 'VERIFIED'] },
        expiresAt: { $gt: now },
      });
    if (q.enabled === 'true')
      restrictions.push({
        $or: [
          { status: 'CLAIMED' },
          {
            status: { $nin: ['CLAIMED', 'DISABLED', 'REVOKED', 'EXPIRED'] },
            expiresAt: { $gt: now },
          },
        ],
      });
    if (q.enabled === 'false')
      restrictions.push({
        $or: [
          { status: { $in: ['DISABLED', 'REVOKED', 'EXPIRED'] } },
          { status: { $ne: 'CLAIMED' }, expiresAt: { $lte: now } },
        ],
      });
    if (restrictions.length)
      filter['$and'] = [...((filter['$and'] as object[]) ?? []), ...restrictions];
    const [items, total] = await Promise.all([
      InstantReward.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      InstantReward.countDocuments(filter),
    ]);
    await Promise.all(items.map((r) => this.flush(r)));
    return {
      data: items.map((r) => this.dto(r, !userId, userId)),
      pagination: pageMeta(q.page, q.pageSize, total),
    };
  }
  async summary() {
    await this.expire();
    const groups = await InstantReward.aggregate<{ _id: string; count: number }>([
      {
        $group: {
          _id: {
            $cond: [
              {
                $and: [
                  { $not: [{ $in: ['$status', ['CLAIMED', 'REVOKED']] }] },
                  { $lte: ['$expiresAt', new Date()] },
                ],
              },
              'EXPIRED',
              '$status',
            ],
          },
          count: { $sum: 1 },
        },
      },
    ]);
    return Object.fromEntries(groups.map((g) => [g._id, g.count]));
  }
  async history(id: string, page: number, pageSize: number) {
    const r = await this.get(id);
    await this.flush(r);
    const [data, total] = await Promise.all([
      InstantRewardEvent.find({ rewardId: r._id }, { _id: 0, __v: 0 })
        .sort({ timestamp: -1, id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      InstantRewardEvent.countDocuments({ rewardId: r._id }),
    ]);
    return { data, pagination: pageMeta(page, pageSize, total) };
  }
  async deliveryEvent(providerId: string, type: string, eventId: string, at: Date) {
    if (await InstantRewardEvent.exists({ id: `provider:${eventId}` })) return;
    let r = await InstantReward.findOne({
      $or: [
        { 'delivery.providerMessageId': providerId },
        { 'verificationDelivery.providerMessageId': providerId },
      ],
    }).lean();
    if (!r) {
      const sent = await InstantRewardEvent.findOne(
        {
          'metadata.providerMessageId': providerId,
          action: { $in: ['EMAIL_SENT', 'VERIFICATION_EMAIL_SENT'] },
        },
        { rewardId: 1 },
      ).lean();
      if (sent?.rewardId) r = await InstantReward.findById(sent.rewardId).lean();
    }
    if (!r) throw new AppError(503, 'DELIVERY_NOT_READY', 'Retry this delivery notification later');
    await this.change(
      String(r._id),
      null,
      type === 'email.delivered' ? 'EMAIL_DELIVERED' : 'EMAIL_FAILED',
      (current) => {
        if (current.delivery?.providerMessageId !== providerId)
          return {
            set:
              current.verificationDelivery?.providerMessageId === providerId &&
              type !== 'email.delivered'
                ? { 'verificationDelivery.errorCode': 'EMAIL_DELIVERY_FAILED' }
                : {},
            metadata: {
              providerEvent: type,
              verification: current.verificationDelivery?.providerMessageId === providerId,
              obsolete: current.verificationDelivery?.providerMessageId !== providerId,
            },
          };
        return {
          set:
            type === 'email.delivered'
              ? {
                  deliveredAt: current.deliveredAt ?? at,
                  ...(current.status === 'SENT' ? { status: 'DELIVERED' } : {}),
                }
              : {
                  'delivery.errorCode': 'EMAIL_DELIVERY_FAILED',
                  ...(['SENT', 'DELIVERED'].includes(current.status) ? { status: 'FAILED' } : {}),
                },
          metadata: { providerEvent: type },
        };
      },
      `provider:${eventId}`,
    );
  }
}
