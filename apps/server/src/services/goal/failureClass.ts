import { HETERO_DISPATCH_ERROR_HEADLINES } from '@/server/services/aiAgent/helpers/heteroErrors';

/**
 * What kind of problem stopped a Goal Task, read off the error it was paused with.
 *
 * Most gates the coordinator opened were not questions about the work: a usage
 * limit that reset on its own a few hours later, a run whose output the server
 * discarded, a working directory that does not exist on the device. Every one of
 * them offered the same Retry / Retire choice, and people picked Retry almost
 * every time. Classifying the failure first lets the coordinator wait out what
 * fixes itself, retry what a retry plausibly fixes, and ask a person only for
 * what needs a person — saying what is broken instead of asking them to judge.
 *
 * - `quota`       — a provider or CLI usage limit; it resets on its own.
 * - `transient`   — a transport or runtime fault a retry plausibly fixes.
 * - `environment` — the setup is broken and a person has to change it.
 * - `judgment`    — everything else, including a delivery that really failed.
 */
export type GoalFailureClass = 'environment' | 'judgment' | 'quota' | 'transient';

/** What a person has to fix, for an `environment` failure. */
export type GoalEnvironmentProblem =
  | { kind: 'cli' }
  | { kind: 'credentials' }
  | { kind: 'device' }
  | { kind: 'gateway' }
  | { kind: 'workingDirectory'; path: string };

export interface GoalFailureClassification {
  class: GoalFailureClass;
  /** `environment` only: what is broken. */
  problem?: GoalEnvironmentProblem;
  /** `quota` only: when the limit says it resets, if it says so. */
  resetAt?: Date;
}

const headline = (code: string) => HETERO_DISPATCH_ERROR_HEADLINES[code];

/** Dispatch failures stored either as the raw gateway code or as its headline. */
const matchesDispatchCode = (error: string, codes: readonly string[]) =>
  codes.some(
    (code) => error.includes(code) || (!!headline(code) && error.includes(headline(code))),
  );

const QUOTA_PATTERNS = [
  // Claude Code: "You've hit your session limit · resets 4:30am (Asia/Shanghai)";
  // Codex: "You've hit your usage limit. ... try again at 5:00 PM".
  /\byou'?ve (?:hit|reached) your (?:[\w-]+ )?limit\b/i,
  /\b(?:session|usage|weekly|daily|5-hour|five-hour) limit\b/i,
  /\bQuotaLimitReached\b/,
];

/** The setup is broken; a retry fails the same way until someone changes it. */
const ENVIRONMENT_RULES: Array<{
  pattern: RegExp;
  problem: (match: RegExpExecArray) => GoalEnvironmentProblem;
}> = [
  {
    pattern: /Working directory (?:does not exist|is not a directory)(?: on [^:]+)?: (\S+)/i,
    problem: (match) => ({ kind: 'workingDirectory', path: match[1].replace(/[.,;]+$/, '') }),
  },
  {
    pattern: /\bwas not found\. Install it\b|\bcli_not_found\b/i,
    problem: () => ({ kind: 'cli' }),
  },
  {
    pattern:
      /\b(?:InvalidProviderAPIKey|NoAvailableProvider|InsufficientQuota|InsufficientBudgetForModel|AccountDeactivated|ModelNotFound)\b|not logged in|please run \/login|auth(?:entication)? required/i,
    problem: () => ({ kind: 'credentials' }),
  },
];

/**
 * Device codes a person has to act on. `DEVICE_OFFLINE` / `DEVICE_CHANNEL_UNAVAILABLE`
 * are waited out by the offline schedule first and only reach a person once it
 * is spent, at which point the fix is the same: bring the device back.
 */
const ENVIRONMENT_DEVICE_CODES = [
  'DEVICE_NOT_FOUND',
  'DEVICE_OFFLINE',
  'DEVICE_CHANNEL_UNAVAILABLE',
  // The device did not answer, so whether the run started is unknown: a person
  // checks the device before anything is started again.
  'DEVICE_RESPONSE_TIMEOUT',
];
const ENVIRONMENT_GATEWAY_CODES = ['DEVICE_GATEWAY_UNAUTHORIZED', 'GATEWAY_NOT_CONFIGURED'];

/**
 * Transport and runtime faults seen ending real Goal runs, each of which a fresh
 * attempt got past: the gateway timing out, the server discarding a run's output
 * because another operation took over its topic, a tool result that did not
 * persist, the device connection service erroring before anything started.
 */
const TRANSIENT_DISPATCH_CODES = [
  'DEVICE_GATEWAY_ERROR',
  'DEVICE_GATEWAY_UNREACHABLE',
  'DEVICE_GATEWAY_RATE_LIMITED',
];
const TRANSIENT_PATTERNS = [
  /"error"\s*:\s*"TIMEOUT"/,
  /\boperation-not-running\b|\bstale-operation\b/,
  /\bFailed to persist tool_result\b/i,
  /\b(?:RateLimitExceeded|ProviderServiceUnavailable|ProviderNetworkError|GatewayTimeout)\b/,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|network error|socket hang up|service unavailable|bad gateway|gateway timeout|\boverloaded\b|\b50[234]\b/i,
];

export const classifyGoalFailure = (
  error: string | null | undefined,
  /** When the failure happened; a wall-clock reset time is read relative to it. */
  failedAt: Date = new Date(),
): GoalFailureClassification => {
  const text = error?.trim();
  if (!text) return { class: 'judgment' };

  if (QUOTA_PATTERNS.some((pattern) => pattern.test(text))) {
    const resetAt = parseQuotaResetAt(text, failedAt);
    return { class: 'quota', ...(resetAt ? { resetAt } : {}) };
  }

  for (const rule of ENVIRONMENT_RULES) {
    const match = rule.pattern.exec(text);
    if (match) return { class: 'environment', problem: rule.problem(match) };
  }
  if (matchesDispatchCode(text, ENVIRONMENT_GATEWAY_CODES))
    return { class: 'environment', problem: { kind: 'gateway' } };
  if (matchesDispatchCode(text, ENVIRONMENT_DEVICE_CODES))
    return { class: 'environment', problem: { kind: 'device' } };

  if (
    matchesDispatchCode(text, TRANSIENT_DISPATCH_CODES) ||
    TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))
  )
    return { class: 'transient' };

  return { class: 'judgment' };
};

/** Machine-class failures are the coordinator's to recover or to explain, not to put up for judgment. */
export const isMachineFailureClass = (failureClass: GoalFailureClass): boolean =>
  failureClass !== 'judgment';

// ---------------------------------------------------------------------------
// Reset time
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ISO_RESET =
  /\b(?:resets?|try again|retry)\s+(?:at\s+|after\s+)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/i;
const RELATIVE_RESET =
  /\b(?:try again|retry|resets?)\s+in\s+((?:\d+(?:\.\d+)?\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b[\s,]*(?:and\s+)?)+)/i;
const RELATIVE_PART =
  /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/gi;
const WALL_CLOCK_RESET =
  /\b(?:resets?|try again at)\s+(?:(?:on\s+)?([A-Z]{3,9})\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(?:(am|pm)\s*)?\(([^()]+)\)/i;

const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };

const unitMs = (unit: string) => {
  const lower = unit.toLowerCase();
  if (lower.startsWith('d')) return UNIT_MS.d;
  if (lower.startsWith('h')) return UNIT_MS.h;
  if (lower.startsWith('m')) return UNIT_MS.m;
  return UNIT_MS.s;
};

const zonedParts = (at: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date(at));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    month: value('month'),
    second: value('second'),
    year: value('year'),
  };
};

const zoneOffsetMs = (at: number, timeZone: string) => {
  const p = zonedParts(at, timeZone);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000
  );
};

/** The instant a wall-clock time in `timeZone` names; the second pass settles DST edges. */
const zonedWallClockToEpoch = (
  wall: { day: number; hour: number; minute: number; month: number; year: number },
  timeZone: string,
) => {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
};

const parseWallClockReset = (match: RegExpExecArray, failedAt: Date): Date | undefined => {
  const [, rawMonth, rawDay, rawHour, rawMinute, meridiem, rawZone] = match;
  const timeZone = rawZone.trim();
  let hour = Number(rawHour);
  const minute = rawMinute ? Number(rawMinute) : 0;
  if (minute > 59) return;
  if (meridiem) {
    if (hour < 1 || hour > 12) return;
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  } else if (hour > 23) return;

  try {
    const now = failedAt.getTime();
    const today = zonedParts(now, timeZone);
    if (rawMonth) {
      const month = MONTHS.indexOf(rawMonth.slice(0, 3).toLowerCase()) + 1;
      const day = Number(rawDay);
      if (!month || day < 1 || day > 31) return;
      let at = zonedWallClockToEpoch({ day, hour, minute, month, year: today.year }, timeZone);
      // "resets Jan 2" read on Dec 30 is next year's.
      if (at <= now)
        at = zonedWallClockToEpoch({ day, hour, minute, month, year: today.year + 1 }, timeZone);
      return new Date(at);
    }
    // A bare time is the next time the clock in that zone reads it.
    let at = zonedWallClockToEpoch({ ...today, hour, minute }, timeZone);
    if (at <= now) {
      const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
      at = zonedWallClockToEpoch(
        {
          day: tomorrow.getUTCDate(),
          hour,
          minute,
          month: tomorrow.getUTCMonth() + 1,
          year: tomorrow.getUTCFullYear(),
        },
        timeZone,
      );
    }
    return new Date(at);
  } catch {
    // An unknown IANA zone: the text gave a time nobody can place.
    return;
  }
};

/**
 * When a usage-limit message says the limit lifts, relative to when it failed.
 * Handles "resets 4:30am (Asia/Shanghai)", "resets Oct 9, 5pm (America/New_York)",
 * "resets at 2026-10-06T04:30:00Z", "try again at 5:00 PM (UTC)" and
 * "try again in 2 hours 13 minutes". A wall-clock time without a zone cannot be
 * placed, so it reads as no reset time.
 */
export const parseQuotaResetAt = (text: string, failedAt: Date): Date | undefined => {
  const iso = ISO_RESET.exec(text);
  if (iso) {
    const at = Date.parse(iso[1]);
    return Number.isNaN(at) ? undefined : new Date(at);
  }

  const relative = RELATIVE_RESET.exec(text);
  if (relative) {
    let total = 0;
    for (const part of relative[1].matchAll(RELATIVE_PART))
      total += Number(part[1]) * unitMs(part[2]);
    return total > 0 ? new Date(failedAt.getTime() + total) : undefined;
  }

  const wall = WALL_CLOCK_RESET.exec(text);
  if (wall) return parseWallClockReset(wall, failedAt);
  return undefined;
};
