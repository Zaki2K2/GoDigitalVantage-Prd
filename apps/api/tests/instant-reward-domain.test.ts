import { describe, it, expect } from 'vitest';
import {
  effectiveStatus,
  canClaimReward,
  adminTransition,
  type RewardState,
} from '../src/modules/instant-rewards/instant-reward.domain';
const state = (over: Partial<RewardState> = {}): RewardState => ({
  status: 'SENT',
  expiresAt: new Date('2099-01-01'),
  verificationRequired: true,
  ...over,
});
describe('Instant Rewards state machine', () => {
  it('requires verification when configured and permits emailed claims otherwise', () => {
    expect(canClaimReward(state())).toBe(false);
    expect(canClaimReward(state({ verificationRequired: false }))).toBe(true);
    expect(canClaimReward(state({ status: 'VERIFIED' }))).toBe(true);
  });
  it('derives expiry even for disabled rewards without unclaiming or unrevoking', () => {
    const expiresAt = new Date(0);
    expect(effectiveStatus(state({ status: 'DISABLED', expiresAt }))).toBe('EXPIRED');
    expect(effectiveStatus(state({ status: 'CLAIMED', expiresAt }))).toBe('CLAIMED');
    expect(effectiveStatus(state({ status: 'REVOKED', expiresAt }))).toBe('REVOKED');
  });
  it('allows temporary disable and restoration while preventing terminal reversals', () => {
    expect(adminTransition(state(), 'disable')).toBe('DISABLED');
    expect(adminTransition(state({ status: 'DISABLED', resumeStatus: 'VERIFIED' }), 'enable')).toBe(
      'VERIFIED',
    );
    expect(() => adminTransition(state({ status: 'CLAIMED' }), 'revoke')).toThrow();
    expect(() => adminTransition(state({ status: 'REVOKED' }), 'enable')).toThrow();
    expect(() =>
      adminTransition(state({ status: 'DISABLED', expiresAt: new Date(0) }), 'enable'),
    ).toThrow();
  });
});
