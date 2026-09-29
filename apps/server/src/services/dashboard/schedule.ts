import { validateCronPattern } from '@lobechat/utils/cronEval';

/** The first cron occurrence strictly after `from`, or null when the pattern is invalid. */
export const nextScheduleOccurrence = (
  pattern: string,
  timezone: string | null | undefined,
  from: Date = new Date(),
): Date | null => {
  const result = validateCronPattern(pattern, timezone ?? null, { count: 1, from });
  return result.valid ? result.nextRuns[0] : null;
};
