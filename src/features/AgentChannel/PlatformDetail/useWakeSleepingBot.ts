import { useEffect, useRef, useState } from 'react';

import type { FieldSchema } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import {
  BOT_RUNTIME_STATUSES,
  BOT_SLEEP_ERROR_CODES,
  type BotRuntimeStatusSnapshot,
} from '@/types/botRuntimeStatus';

export type SleepWakePhase = 'failed' | 'waking' | 'woke';

export interface SleepWake {
  phase: SleepWakePhase;
  /** Whether a plan upgrade would let the bot stay idle longer, as recorded when it slept. */
  upgradable: boolean;
}

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
  snapshot?: Pick<BotRuntimeStatusSnapshot, 'errorCode' | 'status'>;
}

/**
 * Opening a bot that fell asleep from disuse wakes it, once per bot. The phase stays set after the
 * refreshed status stops saying `sleeping`, so the page keeps explaining why the bot had stopped.
 * `undefined` means the bot was not asleep when opened. Whether an upgrade helps is kept from the
 * sleeping status too, since the status no longer carries it once the bot is awake.
 *
 * The page is reused when the user switches bots, so the phase belongs to the bot it was recorded
 * for: another bot starts without one, and a wake still in flight for the previous bot is ignored.
 */
export const useWakeSleepingBot = ({
  applicationId,
  onWoke,
  platform,
  snapshot,
}: UseWakeSleepingBotParams): SleepWake | undefined => {
  const [wake, setWake] = useState<SleepWake & { key: string }>();
  const attempted = useRef<string | undefined>(undefined);

  const asleep = snapshot?.status === BOT_RUNTIME_STATUSES.sleeping;
  const upgradable = snapshot?.errorCode === BOT_SLEEP_ERROR_CODES.idleUpgradable;
  const key = applicationId ? `${platform}:${applicationId}` : undefined;

  useEffect(() => {
    if (!asleep || !applicationId || !key || attempted.current === key) return;
    attempted.current = key;
    const settle = (phase: SleepWakePhase) => {
      if (attempted.current === key) setWake({ key, phase, upgradable });
    };
    settle('waking');
    agentBotProviderService
      .wakeBot({ applicationId, platform })
      .then(() => onWoke())
      .then(() => settle('woke'))
      .catch(() => settle('failed'));
  }, [applicationId, asleep, key, onWoke, platform, upgradable]);

  return wake && wake.key === key ? { phase: wake.phase, upgradable: wake.upgradable } : undefined;
};
