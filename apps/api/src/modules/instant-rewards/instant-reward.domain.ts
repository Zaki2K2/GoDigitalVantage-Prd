import { AppError } from '../../shared/errors';

export const INSTANT_REWARD_STATUSES = [
  'DRAFT',
  'SENT',
  'DELIVERED',
  'VERIFIED',
  'CLAIMED',
  'EXPIRED',
  'DISABLED',
  'REVOKED',
  'FAILED',
] as const;
export type InstantRewardStatus = (typeof INSTANT_REWARD_STATUSES)[number];
export const INSTANT_REWARD_TYPES = [
  'PERCENT_DISCOUNT',
  'FIXED_DISCOUNT',
  'GIFT',
  'CUSTOM',
] as const;
export interface RewardState {
  status: InstantRewardStatus;
  expiresAt: Date;
  verificationRequired: boolean;
  resumeStatus?: InstantRewardStatus | null;
}
export function effectiveStatus(reward: RewardState, now = new Date()): InstantRewardStatus {
  return !['CLAIMED', 'REVOKED'].includes(reward.status) && reward.expiresAt <= now
    ? 'EXPIRED'
    : reward.status;
}
export function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}
export function assertAvailable(reward: RewardState, now = new Date()) {
  const status = effectiveStatus(reward, now);
  if (status === 'EXPIRED') fail('REWARD_EXPIRED', 'This reward has expired');
  if (status === 'DISABLED') fail('REWARD_DISABLED', 'This reward is temporarily disabled');
  if (status === 'REVOKED') fail('REWARD_REVOKED', 'This reward has been permanently revoked');
  if (status === 'CLAIMED') fail('REWARD_ALREADY_CLAIMED', 'This reward has already been claimed');
  return status;
}
export function canClaimReward(reward: RewardState, now = new Date()): boolean {
  const status = effectiveStatus(reward, now);
  return (
    status === 'VERIFIED' ||
    (!reward.verificationRequired && ['SENT', 'DELIVERED'].includes(status))
  );
}
export function adminTransition(
  reward: RewardState,
  action: 'enable' | 'disable' | 'revoke',
  now = new Date(),
): InstantRewardStatus {
  if (action === 'enable') {
    assertAvailable(
      {
        ...reward,
        status: reward.status === 'DISABLED' ? (reward.resumeStatus ?? 'DRAFT') : reward.status,
      },
      now,
    );
    if (reward.status !== 'DISABLED')
      fail('REWARD_INVALID_STATE', 'Only disabled rewards can be enabled');
    return reward.resumeStatus ?? 'DRAFT';
  }
  if (reward.status === 'CLAIMED')
    fail('REWARD_ALREADY_CLAIMED', 'Claimed rewards cannot be disabled or revoked');
  if (reward.status === 'REVOKED') fail('REWARD_REVOKED', 'Revocation is permanent');
  if (action === 'revoke') return 'REVOKED';
  assertAvailable(reward, now);
  return 'DISABLED';
}
