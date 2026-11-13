import {
  hasSameScheduleMinute,
  isPreciseSchedulePattern,
  isValidTimezone,
  validateCronPattern,
  validateScheduleUpdate,
} from '@lobechat/utils/cronEval';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { checkPreciseScheduleAccess } from '@/business/server/task/preciseSchedule';

/**
 * Write-time schedule validation, shared by every boundary that can create or
 * patch a task: the tRPC router the in-app surfaces call and the REST routes
 * the OpenAPI SDK is generated from. Both must refuse a schedule the
 * dispatcher cannot evaluate, or the task is stored and then silently never
 * fires.
 */

/**
 * Reject cron the schedule dispatcher cannot evaluate at write time, instead of
 * storing it and letting it silently never fire. An empty string still clears.
 */
export const schedulePatternSchema = z.string().superRefine((pattern, ctx) => {
  if (!pattern) return;
  const result = validateCronPattern(pattern, null);
  if (!result.valid) {
    ctx.addIssue({
      code: 'custom',
      message: `Invalid schedulePattern "${pattern}": ${result.error}`,
    });
  }
});

export const scheduleTimezoneSchema = z.string().refine((tz) => !tz || isValidTimezone(tz), {
  message: 'scheduleTimezone must be an IANA timezone such as "Asia/Shanghai"',
});

/**
 * The field schemas check `schedulePattern` and `scheduleTimezone` one at a
 * time; this checks the pair the task ends up with, filling any field the
 * input leaves out from the stored row, so e.g. a pattern-only update cannot
 * keep a legacy invalid timezone and still report success.
 */
export function assertResultingScheduleValid(
  stored: { schedulePattern?: string | null; scheduleTimezone?: string | null } | null,
  input: {
    automationMode?: string | null;
    schedulePattern?: string | null;
    scheduleTimezone?: string | null;
  },
) {
  const result = validateScheduleUpdate(
    stored ? { pattern: stored.schedulePattern, timezone: stored.scheduleTimezone } : null,
    input,
  );
  if (result && !result.valid) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid schedule: ${result.error}` });
  }
}

/**
 * Enforce a deployment's plan rule for custom exact times at every write
 * boundary. Only picking a new exact minute is checked: a schedule that already
 * has one keeps running and stays editable after a downgrade.
 */
export async function assertPreciseScheduleAllowed(
  actor: { userId: string; workspaceId?: string | null },
  storedPattern: string | null | undefined,
  nextPattern: string | null | undefined,
) {
  if (!nextPattern || !isPreciseSchedulePattern(nextPattern)) return;
  if (storedPattern && hasSameScheduleMinute(storedPattern, nextPattern)) return;

  const access = await checkPreciseScheduleAccess(actor);
  if (!access.allowed) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: access.message });
  }
}
