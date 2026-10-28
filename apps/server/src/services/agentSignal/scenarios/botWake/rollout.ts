import { botWakeRolloutCheckCounter } from '@lobechat/observability-otel/modules/bot-wake';
import debug from 'debug';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

const log = debug('lobe-server:bot-wake:rollout');

/**
 * How long one answer is reused. The runtime flag provider already caches for seconds and, for a
 * user with no override, reads Redis on every call; a bot sees several decisions per message, so
 * without this a single message would cost several flag reads. Turning the flag off takes effect
 * within this window plus the provider's own cache.
 */
export const BOT_WAKE_ROLLOUT_CACHE_MS = 10_000;

export interface BotWakeRolloutProbeOptions {
  /** Clock for the cache; injectable for tests. */
  now?: () => number;
  /** Reads the flag for a user. Defaults to the runtime feature flags; injectable for tests. */
  read?: (userId: string) => Promise<boolean | undefined>;
  ttlMs?: number;
}

const readRuntimeFlag = async (userId: string) =>
  (await getServerFeatureFlagsStateFromRuntimeConfig(userId)).enableBotWake;

/**
 * Whether the `bot_wake` rollout flag is on for one bot owner.
 *
 * Use when:
 * - Anything that changes what a bot does or writes because of the bot-wake pipeline is about to
 *   run. The flag is the master switch; a bot's own `botWake` config only matters once it is on.
 *
 * Returns a function that:
 * - answers `true` only for an explicit yes
 * - answers `false` when the flag is off, unset, or could not be read. Failing closed keeps the
 *   bot on its previous behaviour, which is the safe side of a rollout.
 * - shares one in-flight read between concurrent callers and reuses the answer for
 *   {@link BOT_WAKE_ROLLOUT_CACHE_MS}
 */
export const createBotWakeRolloutProbe = (
  userId: string,
  options: BotWakeRolloutProbeOptions = {},
): (() => Promise<boolean>) => {
  const read = options.read ?? readRuntimeFlag;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? BOT_WAKE_ROLLOUT_CACHE_MS;

  let cached: { expiresAt: number; value: boolean } | undefined;
  let inFlight: Promise<boolean> | undefined;

  const evaluate = async (): Promise<boolean> => {
    try {
      const value = (await read(userId)) === true;
      botWakeRolloutCheckCounter.add(1, { result: value ? 'on' : 'off' });

      return value;
    } catch (error) {
      botWakeRolloutCheckCounter.add(1, { result: 'error' });
      log('flag read failed, treating bot_wake as off: %O', error);

      return false;
    }
  };

  return async () => {
    if (cached && cached.expiresAt > now()) return cached.value;

    inFlight ??= evaluate()
      .then((value) => {
        cached = { expiresAt: now() + ttlMs, value };

        return value;
      })
      .finally(() => {
        inFlight = undefined;
      });

    return inFlight;
  };
};
