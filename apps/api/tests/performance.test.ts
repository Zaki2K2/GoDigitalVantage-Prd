import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { list } from '../src/modules/admin/admin.service';
import { listSchema } from '../src/modules/admin/admin.schemas';
import { findMembership } from '../src/modules/businesses/business.service';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { Business } from '../src/modules/businesses/business.model';

afterEach(() => vi.restoreAllMocks());

describe('independent authorization reads', () => {
  it('starts business moderation lookup before membership lookup finishes, preserving the result', async () => {
    let resolve!: (value: { role: string; status: string }) => void;
    const membership = new Promise<{ role: string; status: string }>((r) => {
      resolve = r;
    });
    vi.spyOn(BusinessMembership, 'findOne').mockReturnValue({ lean: () => membership } as never);
    const business = vi.spyOn(Business, 'findById').mockReturnValue({
      lean: () => Promise.resolve({ status: 'active', adminState: 'active' }),
    } as never);
    const result = findMembership('user', 'business');
    expect(business).toHaveBeenCalledOnce();
    resolve({ role: 'member', status: 'active' });
    await expect(result).resolves.toEqual({ role: 'member' });
  });
  for (const [membership, business] of [
    [null, { status: 'active' }],
    [{ role: 'owner', status: 'disabled' }, { status: 'active' }],
    [{ role: 'owner' }, { status: 'disabled' }],
    [{ role: 'owner' }, { status: 'active', adminState: 'suspended' }],
    [{ role: 'owner' }, null],
  ]) {
    it(
      'still rejects unavailable memberships and businesses: ' +
        JSON.stringify([membership, business]),
      async () => {
        vi.spyOn(BusinessMembership, 'findOne').mockReturnValue({
          lean: () => Promise.resolve(membership),
        } as never);
        vi.spyOn(Business, 'findById').mockReturnValue({
          lean: () => Promise.resolve(business),
        } as never);
        await expect(findMembership('user', 'business')).resolves.toBeNull();
      },
    );
  }
});

describe('Admin list database work', () => {
  it('does not issue any enrichment queries for an empty activity page', async () => {
    const collection = vi.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name !== 'admin_audit') throw new Error('Unexpected empty enrichment query');
      return { aggregate: () => ({ toArray: async () => [{ items: [], count: [] }] }) } as never;
    });
    const result = await list('activity', listSchema.parse({}));
    expect(result.data).toEqual([]);
    expect(collection).toHaveBeenCalledExactlyOnceWith('admin_audit');
  });
  it('loads counts concurrently with owner enrichment and skips unrelated lookups', async () => {
    const id = new Types.ObjectId(),
      ownerId = new Types.ObjectId();
    let release!: (value: unknown[]) => void;
    const owner = new Promise<unknown[]>((resolve) => {
      release = resolve;
    });
    const counts = vi.fn();
    vi.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'businesses')
        return {
          aggregate: () => ({
            toArray: async () => [
              { items: [{ _id: id, ownerUserId: ownerId }], count: [{ total: 1 }] },
            ],
          }),
        } as never;
      if (name === 'users') return { find: () => ({ toArray: () => owner }) } as never;
      return {
        aggregate: () => ({
          toArray: async () => {
            counts(name);
            return [{ _id: id, count: 2 }];
          },
        }),
      } as never;
    });
    const pending = list('businesses', listSchema.parse({}));
    await Promise.resolve();
    await Promise.resolve();
    expect(counts.mock.calls.flat().sort()).toEqual([
      'business_memberships',
      'questionnaires',
      'responses',
    ]);
    release([{ _id: ownerId }]);
    const result = await pending;
    expect(result.data[0]).toMatchObject({
      memberCount: 2,
      formCount: 2,
      responseCount: 2,
      owner: { _id: ownerId },
    });
  });
});
