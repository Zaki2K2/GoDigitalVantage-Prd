import { randomUUID } from 'node:crypto';
import { AppError, unauthorized } from '../../shared/errors';
import type { LoginInput, RegisterInput } from './auth.schemas';
import { dummyHash, hashPassword, verifyPassword } from './password';
import { RefreshToken, type RefreshTokenDoc } from './refresh-token.model';
import { hashToken, newOpaqueToken, REFRESH_TTL_SECONDS, signAccessToken } from './tokens';
import { User, type UserDoc } from './user.model';

const REUSE_GRACE_MS = 10_000;

export interface Session {
  user: UserDoc;
  accessToken: string;
  /** Null on the grace-window path: the caller keeps the cookie from the winning rotation. */
  refreshToken: string | null;
}

async function issueRefreshToken(userId: UserDoc['_id'], familyId: string): Promise<string> {
  const token = newOpaqueToken();
  await RefreshToken.create({
    userId,
    familyId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });
  return token;
}

async function startSession(user: UserDoc): Promise<Session> {
  return {
    user,
    accessToken: signAccessToken(user._id.toString()),
    refreshToken: await issueRefreshToken(user._id, randomUUID()),
  };
}

export async function register(input: RegisterInput): Promise<Session> {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await User.create({
      fullName: input.fullName,
      emailLowercase: input.email,
      passwordHash,
    });
    return await startSession(user.toObject());
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function login(input: LoginInput): Promise<Session> {
  const user = await User.findOne({ emailLowercase: input.email }).lean();
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok || user.status !== 'active') {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  return startSession(user);
}

/** Rotates the refresh token. Presenting an already-used token revokes its whole family. */
export async function refresh(presented: string | undefined): Promise<Session> {
  if (!presented) throw unauthorized('Missing refresh token');
  const existing = await RefreshToken.findOne({ tokenHash: hashToken(presented) }).lean();
  if (!existing) throw unauthorized('Invalid refresh token');

  if (existing.revokedAt) {
    if (isBenignRace(existing)) return rotateFrom(existing, false);
    await revokeFamily(existing.familyId);
    throw unauthorized('Refresh token reuse detected');
  }
  if (existing.expiresAt.getTime() <= Date.now()) throw unauthorized('Refresh token expired');

  return rotateFrom(existing, true);
}

/**
 * Two tabs can legitimately send the same cookie at the same instant. A token rotated within
 * the grace window, whose family is still alive, is treated as that race, not as theft.
 */
function isBenignRace(token: RefreshTokenDoc): boolean {
  return (
    !token.familyRevoked &&
    !!token.rotatedAt &&
    Date.now() - token.rotatedAt.getTime() <= REUSE_GRACE_MS
  );
}

async function rotateFrom(existing: RefreshTokenDoc, claim: boolean): Promise<Session> {
  if (claim) {
    // Atomic claim: only one concurrent request can rotate this token.
    const now = new Date();
    const claimed = await RefreshToken.findOneAndUpdate(
      { _id: existing._id, revokedAt: null },
      { revokedAt: now, rotatedAt: now },
    ).lean();
    if (!claimed) {
      if (await isBenignRaceById(existing._id)) return rotateFrom(existing, false);
      await revokeFamily(existing.familyId);
      throw unauthorized('Refresh token reuse detected');
    }
  }

  const user = await User.findById(existing.userId).lean();
  if (!user || user.status !== 'active') {
    await revokeFamily(existing.familyId);
    throw unauthorized('Account unavailable');
  }
  return {
    user,
    accessToken: signAccessToken(user._id.toString()),
    // Grace-window replays get a short-lived access token only, never a new refresh token,
    // so a stolen just-rotated token cannot be turned into a persistent session.
    refreshToken: claim ? await issueRefreshToken(user._id, existing.familyId) : null,
  };
}

async function isBenignRaceById(id: RefreshTokenDoc['_id']): Promise<boolean> {
  const fresh = await RefreshToken.findById(id).lean();
  return fresh ? isBenignRace(fresh) : false;
}

export async function logout(presented: string | undefined): Promise<void> {
  if (!presented) return;
  const existing = await RefreshToken.findOne({ tokenHash: hashToken(presented) }).lean();
  if (existing) await revokeFamily(existing.familyId);
}

async function revokeFamily(familyId: string): Promise<void> {
  const now = new Date();
  await RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: now });
  await RefreshToken.updateMany({ familyId }, { familyRevoked: true });
}

export async function getActiveUser(userId: string): Promise<UserDoc> {
  const user = /^[a-f\d]{24}$/i.test(userId) ? await User.findById(userId).lean() : null;
  if (!user || user.status !== 'active') throw unauthorized();
  return user;
}
