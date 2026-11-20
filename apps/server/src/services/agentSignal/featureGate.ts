import type { UserPreference } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Reads the Labs → Self-evolving switch out of a loaded user preference.
 *
 * Use when:
 * - The caller already holds `users.preference` and must not read it again
 *
 * Returns:
 * - `true` only when `preference.lab.enableSelfLearning` is explicitly `true`
 */
export const isSelfLearningEnabledInPreference = (
  preference: Pick<UserPreference, 'lab'> | null | undefined,
) => preference?.lab?.enableSelfLearning === true;

/**
 * How long one user's resolved switch is reused inside this process.
 *
 * Agent Signal asks on every runtime step and every enqueued source event, so an uncached read
 * would add a `users` lookup to each of them. Five seconds matches the feature-flag runtime
 * cache this gate replaced; a toggle reaches background work within that window.
 */
const USER_GATE_CACHE_TTL_MS = 5000;
/** Bounds the cache; past it the whole map is dropped rather than tracking recency. */
const USER_GATE_CACHE_MAX_ENTRIES = 5000;

const userGateCache = new Map<string, { expiresAt: number; value: Promise<boolean> }>();

/** Clears the per-process switch cache. Tests only. */
export const resetAgentSignalUserGateCache = () => userGateCache.clear();

const readSelfLearningSwitch = async (db: LobeChatDatabase, userId: string) => {
  try {
    const preference = await new UserModel(db, userId).getUserPreference();

    return isSelfLearningEnabledInPreference(preference);
  } catch (error) {
    console.error('[AgentSignal] Failed to read the Self-evolving Labs switch:', error);
    return false;
  }
};

/**
 * Resolves whether Agent Signal self-iteration and Self-evolving learning may run for one user.
 *
 * The single user-level gate is the Labs → Self-evolving switch
 * (`users.preference.lab.enableSelfLearning`). It covers background memory and skill writes,
 * reflection, self-feedback intent, nightly review, and expertise lessons alike.
 *
 * Use when:
 * - A server entrypoint needs to decide whether Agent Signal may execute
 *
 * Expects:
 * - `userId` belongs to the user whose credentials the work bills to
 * - `options.preference`, when the caller already loaded the row, skips the read
 *
 * Returns:
 * - `true` only when the user turned the Labs switch on; read failures resolve to `false`
 */
export const isAgentSignalEnabledForUser = async (
  db: LobeChatDatabase,
  userId: string,
  options: { preference?: Pick<UserPreference, 'lab'> | null } = {},
): Promise<boolean> => {
  if ('preference' in options) return isSelfLearningEnabledInPreference(options.preference);

  const now = Date.now();
  const cached = userGateCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.value;

  if (userGateCache.size >= USER_GATE_CACHE_MAX_ENTRIES) userGateCache.clear();

  const value = readSelfLearningSwitch(db, userId);
  userGateCache.set(userId, { expiresAt: now + USER_GATE_CACHE_TTL_MS, value });

  return value;
};
