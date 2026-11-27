import { useEffect, useRef, useState } from 'react';

import type { FieldSchema } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '@/types/botRuntimeStatus';

export type SleepWakePhase = 'failed' | 'waking' | 'woke';

/** Whether the platform's settings offer webhook mode, which never sleeps. */
export const supportsWebhookMode = (schema: FieldSchema[]): boolean =>
  schema
    .find((field) => field.key === 'settings')
    ?.properties?.some(
      (field) => field.key === 'connectionMode' && field.enum?.includes('webhook'),
    ) ?? false;

interface UseWakeSleepingBotParams {
  applicationId?: string;
  onWoke: () => Promise<unknown>;
  platform: string;
  status?: BotRuntimeStatus;
}

/**
 * Opening a bot that fell asleep from disuse wakes it, once per bot. The phase stays set after the
 * refreshed status stops saying `sleeping`, so the page keeps explaining why the bot had stopped.
 * `undefined` means the bot was not asleep when opened.
 *
 * The page is reused when the user switches bots, so the phase belongs to the bot it was recorded
 * for: another bot starts without one, and a wake still in flight for the previous bot is ignored.
 */
export const useWakeSleepingBot = ({
  applicationId,
  onWoke,
  platform,
  status,
}: UseWakeSleepingBotParams): SleepWakePhase | undefined => {
  const [wake, setWake] = useState<{ key: string; phase: SleepWakePhase }>();
  const attempted = useRef<string | undefined>(undefined);

  const asleep = status === BOT_RUNTIME_STATUSES.sleeping;
  const key = applicationId ? `${platform}:${applicationId}` : undefined;

  useEffect(() => {
    if (!asleep || !applicationId || !key || attempted.current === key) return;
    attempted.current = key;
    const settle = (phase: SleepWakePhase) => {
      if (attempted.current === key) setWake({ key, phase });
    };
    settle('waking');
    agentBotProviderService
      .wakeBot({ applicationId, platform })
      .then(() => onWoke())
      .then(() => settle('woke'))
      .catch(() => settle('failed'));
  }, [applicationId, asleep, key, onWoke, platform]);

  return wake && wake.key === key ? wake.phase : undefined;
};
