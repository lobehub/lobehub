import { eq } from 'drizzle-orm';

import { aicoMasterMonitorState } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { microUsdToDecimalString } from '@/database/utils/aicoMoney';

import { sendSecurityAlert } from './securityAlert';

const DEFAULT_THRESHOLD_MICRO = 100_000_000; // $100
const STALE_MS = 24 * 60 * 60_000;

/**
 * Refresh master OpenRouter monitor snapshot (MON-003).
 * OpenRouter Management API has no documented prepaid balance endpoint —
 * we persist observed usage and never fabricate a zero balance.
 *
 * Staleness is evaluated against the previous successful check timestamp
 * before we stamp a new heartbeat.
 */
export const refreshAicoMasterMonitorState = async (
  db: LobeChatDatabase,
  usageMicroUsd: number,
): Promise<{
  availableCreditMicroUsd: number | null;
  belowThreshold: boolean | null;
  isStub: boolean;
  lastSuccessfulCheckAt: string | null;
  status: string;
  thresholdUsd: string;
  totalObservedUsageUsd: string;
}> => {
  const now = new Date();
  const thresholdMicro = DEFAULT_THRESHOLD_MICRO;

  try {
    const previous = await db.query.aicoMasterMonitorState.findFirst({
      where: eq(aicoMasterMonitorState.id, 'default'),
    });

    const previousCheck = previous?.lastSuccessfulCheckAt ?? null;
    if (previousCheck && now.getTime() - previousCheck.getTime() > STALE_MS) {
      await sendSecurityAlert(db, {
        dedupeKey: 'master.check_stale',
        details: { lastSuccessfulCheckAt: previousCheck.toISOString() },
        severity: 'warning',
        summary: 'OpenRouter master monitor check is stale',
        type: 'master.check_stale',
      });
    }

    await db
      .insert(aicoMasterMonitorState)
      .values({
        availableCreditMicroUsd: null,
        id: 'default',
        lastError: null,
        lastSuccessfulCheckAt: now,
        lowCreditThresholdMicroUsd: thresholdMicro,
        observedBurnMicroUsdPerDay: null,
        status: 'unknown',
      })
      .onConflictDoUpdate({
        set: {
          lastError: null,
          lastSuccessfulCheckAt: now,
          lowCreditThresholdMicroUsd: thresholdMicro,
          status: 'unknown',
          updatedAt: now,
        },
        target: aicoMasterMonitorState.id,
      });

    // Balance remains unknown (API limitation) — not fabricated.
    return {
      availableCreditMicroUsd: null,
      belowThreshold: null,
      isStub: false,
      lastSuccessfulCheckAt: now.toISOString(),
      status: 'unknown',
      thresholdUsd: microUsdToDecimalString(thresholdMicro),
      totalObservedUsageUsd: microUsdToDecimalString(usageMicroUsd),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await db
        .insert(aicoMasterMonitorState)
        .values({
          id: 'default',
          lastError: message.slice(0, 500),
          status: 'error',
        })
        .onConflictDoUpdate({
          set: {
            lastError: message.slice(0, 500),
            status: 'error',
            updatedAt: now,
          },
          target: aicoMasterMonitorState.id,
        });
    } catch {
      // ignore secondary write failures
    }

    await sendSecurityAlert(db, {
      dedupeKey: 'master.balance_unknown_error',
      details: { error: message.slice(0, 200) },
      severity: 'critical',
      summary: 'Failed to refresh OpenRouter master monitor state',
      type: 'master.balance_unknown_error',
    });

    return {
      availableCreditMicroUsd: null,
      belowThreshold: null,
      isStub: false,
      lastSuccessfulCheckAt: null,
      status: 'error',
      thresholdUsd: microUsdToDecimalString(thresholdMicro),
      totalObservedUsageUsd: microUsdToDecimalString(usageMicroUsd),
    };
  }
};
