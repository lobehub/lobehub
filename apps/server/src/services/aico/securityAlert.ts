import debug from 'debug';
import { eq, sql } from 'drizzle-orm';

import { aicoSecurityAlertState } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { aicoEnv } from '@/envs/aico';

const log = debug('lobe-aico:security-alert');

export type SecurityAlertSeverity = 'info' | 'warning' | 'critical';

export type SecurityAlertType =
  | 'auth.rate_limit_burst'
  | 'auth.otp_abuse'
  | 'outbox.exhausted'
  | 'master.balance_unknown_error'
  | 'master.below_threshold'
  | 'master.check_stale';

export interface SendSecurityAlertParams {
  cooldownMs?: number;
  /** Stable key for dedupe/cooldown (defaults to type). */
  dedupeKey?: string;
  details?: Record<string, unknown>;
  severity: SecurityAlertSeverity;
  summary: string;
  type: SecurityAlertType | (string & {});
}

const DEFAULT_COOLDOWN_MS = 15 * 60_000;

/** Process-local cooldown when DB is unavailable (e.g. Better Auth hooks). */
const memoryAlertCooldown = new Map<string, number>();

const isMemoryCooldownActive = (dedupeKey: string, cooldownMs: number, nowMs: number) => {
  const last = memoryAlertCooldown.get(dedupeKey);
  if (last !== undefined && nowMs - last < cooldownMs) {
    return true;
  }
  memoryAlertCooldown.set(dedupeKey, nowMs);
  return false;
};

/**
 * Ops security alert with DB-backed dedupe (MON-003).
 * Posts to AICO_SECURITY_ALERT_WEBHOOK_URL when set; always logs.
 * Falls back to in-process cooldown when `db` is null.
 */
export const sendSecurityAlert = async (
  db: LobeChatDatabase | null,
  params: SendSecurityAlertParams,
): Promise<{ sent: boolean }> => {
  const dedupeKey = params.dedupeKey ?? params.type;
  const cooldownMs = params.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = new Date();

  if (db) {
    try {
      const existing = await db.query.aicoSecurityAlertState.findFirst({
        where: eq(aicoSecurityAlertState.id, dedupeKey),
      });
      if (
        existing?.lastAlertedAt &&
        now.getTime() - existing.lastAlertedAt.getTime() < cooldownMs
      ) {
        await db
          .update(aicoSecurityAlertState)
          .set({ hitCount: sql`${aicoSecurityAlertState.hitCount} + 1` })
          .where(eq(aicoSecurityAlertState.id, dedupeKey));
        return { sent: false };
      }

      await db
        .insert(aicoSecurityAlertState)
        .values({
          hitCount: 1,
          id: dedupeKey,
          lastAlertedAt: now,
        })
        .onConflictDoUpdate({
          set: {
            hitCount: sql`${aicoSecurityAlertState.hitCount} + 1`,
            lastAlertedAt: now,
          },
          target: aicoSecurityAlertState.id,
        });
    } catch (error) {
      log('alert state upsert failed %O', error);
      // DB failed — still apply process-local cooldown to avoid webhook storms.
      if (isMemoryCooldownActive(dedupeKey, cooldownMs, now.getTime())) {
        return { sent: false };
      }
    }
  } else if (isMemoryCooldownActive(dedupeKey, cooldownMs, now.getTime())) {
    return { sent: false };
  }

  const payload = {
    details: params.details ?? {},
    severity: params.severity,
    summary: params.summary,
    timestamp: now.toISOString(),
    type: params.type,
  };

  console.error('[aico-security-alert]', JSON.stringify(payload));

  const webhookUrl = aicoEnv.AICO_SECURITY_ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    return { sent: true };
  }

  try {
    const response = await fetch(webhookUrl, {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      log('webhook returned %s', response.status);
    }
  } catch (error) {
    log('webhook post failed %O', error);
  }

  return { sent: true };
};

/** In-process sliding window for auth abuse signals (per process). */
const abuseHits = new Map<string, number[]>();

export const recordAuthAbuseSignal = async (
  db: LobeChatDatabase | null,
  params: {
    kind: 'rate_limit' | 'otp_fail';
    key: string;
    threshold?: number;
    windowMs?: number;
  },
): Promise<void> => {
  const windowMs = params.windowMs ?? 5 * 60_000;
  const threshold = params.threshold ?? 20;
  const now = Date.now();
  const bucketKey = `${params.kind}:${params.key}`;
  const recent = (abuseHits.get(bucketKey) ?? []).filter((ts) => ts > now - windowMs);
  recent.push(now);
  abuseHits.set(bucketKey, recent);

  if (recent.length < threshold) return;

  await sendSecurityAlert(db, {
    cooldownMs: 15 * 60_000,
    dedupeKey: `auth-abuse:${bucketKey}`,
    details: { count: recent.length, kind: params.kind, windowMs },
    severity: 'warning',
    summary:
      params.kind === 'otp_fail'
        ? `Suspicious OTP verification attempt burst (${recent.length} in window)`
        : `Auth rate-limit burst (${recent.length} in window)`,
    type: params.kind === 'otp_fail' ? 'auth.otp_abuse' : 'auth.rate_limit_burst',
  });
};

/** Test helper */
export const resetAuthAbuseSignalsForTests = () => {
  abuseHits.clear();
  memoryAlertCooldown.clear();
};
