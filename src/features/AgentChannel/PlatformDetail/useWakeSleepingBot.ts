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
 */
export const useWakeSleepingBot = ({
  applicationId,
  onWoke,
  platform,
  status,
}: UseWakeSleepingBotParams): SleepWakePhase | undefined => {
  const [phase, setPhase] = useState<SleepWakePhase>();
  const attempted = useRef<string | undefined>(undefined);

  const asleep = status === BOT_RUNTIME_STATUSES.sleeping;
  const key = applicationId ? `${platform}:${applicationId}` : undefined;

  useEffect(() => {
    if (!asleep || !applicationId || attempted.current === key) return;
    attempted.current = key;
    setPhase('waking');
    agentBotProviderService
      .wakeBot({ applicationId, platform })
      .then(() => onWoke())
      .then(() => setPhase('woke'))
      .catch(() => setPhase('failed'));
  }, [applicationId, asleep, key, onWoke, platform]);

  return phase;
};
