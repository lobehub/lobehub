import debug from 'debug';

import { getBotSleepState } from '@/business/server/bot/sleep';

import { BOT_RUNTIME_STATUSES, getBotRuntimeStatus, updateBotRuntimeStatus } from './runtimeStatus';

const log = debug('lobe-server:service:gateway:sleep');

interface SleepCheckProvider {
  applicationId: string;
  id: string;
  lastActiveAt: Date;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Whether the runtime should keep `provider`'s persistent connection down
 * because the bot sat idle, recording `sleeping` on its runtime status when
 * so. Asked only by the paths that keep connections alive (sync, cron): an
 * owner connecting by hand restarts the idle clock first.
 *
 * Fails open: a sleep check that errors keeps the connection, the same way a
 * flaky feature-gate lookup must not tear down a healthy bot.
 */
export async function isBotAsleep(
  platform: string,
  provider: SleepCheckProvider,
): Promise<boolean> {
  let state;
  try {
    state = await getBotSleepState({
      applicationId: provider.applicationId,
      lastActiveAt: provider.lastActiveAt,
      platform,
      userId: provider.userId,
      workspaceId: provider.workspaceId ?? undefined,
    });
  } catch (err) {
    log('sleep check failed for %s, keeping connection: %O', provider.id, err);
    return false;
  }
  if (!state.asleep) return false;

  // Best-effort label for the UI, written only when it changes: every sync
  // re-derives the same verdict for the same idle bots.
  try {
    const current = await getBotRuntimeStatus(platform, provider.applicationId);
    if (
      current?.status !== BOT_RUNTIME_STATUSES.sleeping ||
      current.errorMessage !== state.message
    ) {
      await updateBotRuntimeStatus({
        applicationId: provider.applicationId,
        errorMessage: state.message,
        platform,
        status: BOT_RUNTIME_STATUSES.sleeping,
      });
    }
  } catch (err) {
    log('could not record sleeping status for %s: %O', provider.id, err);
  }

  return true;
}
