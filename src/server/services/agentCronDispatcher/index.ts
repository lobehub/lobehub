import debug from 'debug';
import pMap from 'p-map';

import { AgentCronJobModel } from '@/database/models/agentCronJob';
import { type AgentCronJob } from '@/database/schemas/agentCronJob';
import { type LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent-cron-dispatcher');

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_LOCK_TTL_SECONDS = 120;
const DEFAULT_MAX_JOBS_PER_TICK = 100;
const FALLBACK_TIMEZONE = 'UTC';

interface DispatchJobResult {
  jobId: string;
  operationId?: string;
  reason?: string;
  status: 'failed' | 'skipped' | 'triggered';
}

interface DispatchStats {
  durationMs: number;
  eligible: number;
  failed: number;
  scanned: number;
  skipped: number;
  triggered: number;
}

export interface AgentCronDispatchResult {
  dryRun: boolean;
  jobs: DispatchJobResult[];
  stats: DispatchStats;
  tickAt: string;
}

export interface AgentCronDispatcherOptions {
  concurrency?: number;
  lockTtlSeconds?: number;
  maxJobsPerTick?: number;
}

export interface AgentCronDispatchParams {
  dryRun?: boolean;
  now?: Date;
}

export interface TimeParts {
  day: number;
  hour: number;
  minute: number;
  month: number;
  slotId: string;
  weekday: number;
  year: number;
}

interface DueCheckResult {
  due: boolean;
  reason?: string;
  slotId: string;
  timezone: string;
}

const weekdayIndexMap: Record<string, number> = {
  Fri: 5,
  Mon: 1,
  Sat: 6,
  Sun: 0,
  Thu: 4,
  Tue: 2,
  Wed: 3,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const inMemoryLockStore = new Map<string, number>();

const nonEligibleReasons = new Set([
  'already_executed_this_slot',
  'not_due',
  'time_range_not_allowed',
  'weekday_not_allowed',
]);

const parsePositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);

  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return parsed;
};

const formatPart = (num: number): string => String(num).padStart(2, '0');

const getFormatter = (timezone: string): Intl.DateTimeFormat => {
  if (!formatterCache.has(timezone)) {
    formatterCache.set(
      timezone,
      new Intl.DateTimeFormat('en-US', {
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
        minute: '2-digit',
        month: '2-digit',
        timeZone: timezone,
        weekday: 'short',
        year: 'numeric',
      }),
    );
  }

  return formatterCache.get(timezone)!;
};

const normalizeTimezone = (timezone?: string | null): string => {
  if (!timezone) return FALLBACK_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return FALLBACK_TIMEZONE;
  }
};

const getTimeParts = (date: Date, timezone: string): TimeParts => {
  const parts = getFormatter(timezone).formatToParts(date);
  const valueMap: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== 'literal') valueMap[part.type] = part.value;
  }

  const year = Number.parseInt(valueMap.year, 10);
  const month = Number.parseInt(valueMap.month, 10);
  const day = Number.parseInt(valueMap.day, 10);
  const hour = Number.parseInt(valueMap.hour, 10);
  const minute = Number.parseInt(valueMap.minute, 10);
  const weekday = weekdayIndexMap[valueMap.weekday] ?? 0;

  return {
    day,
    hour,
    minute,
    month,
    slotId: `${year}${formatPart(month)}${formatPart(day)}${formatPart(hour)}${formatPart(minute)}`,
    weekday,
    year,
  };
};

const parseIntSafe = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) return null;

  return parsed;
};

const normalizeWeekdayValue = (value: number): number => {
  if (value === 7) return 0;

  return value;
};

const matchesCronSegment = (
  segment: string,
  currentValue: number,
  _min: number,
  _max: number,
  normalizer?: (value: number) => number,
): boolean => {
  const value = normalizer ? normalizer(currentValue) : currentValue;

  if (segment === '*') return true;

  const values = segment.split(',');

  const matchesPart = (part: string): boolean => {
    if (!part) return false;

    if (part.includes('/')) {
      const [base, stepRaw] = part.split('/');
      const step = parseIntSafe(stepRaw);
      if (!step || step <= 0) return false;

      if (base === '*') {
        return value % step === 0;
      }

      if (base.includes('-')) {
        const [startRaw, endRaw] = base.split('-');
        const startParsed = parseIntSafe(startRaw);
        const endParsed = parseIntSafe(endRaw);

        if (startParsed === null || endParsed === null) return false;

        const start = normalizer ? normalizer(startParsed) : startParsed;
        const end = normalizer ? normalizer(endParsed) : endParsed;

        if (value < start || value > end) return false;

        return (value - start) % step === 0;
      }

      const startParsed = parseIntSafe(base);
      if (startParsed === null) return false;

      const start = normalizer ? normalizer(startParsed) : startParsed;

      if (value < start) return false;

      return (value - start) % step === 0;
    }

    if (part.includes('-')) {
      const [startRaw, endRaw] = part.split('-');
      const startParsed = parseIntSafe(startRaw);
      const endParsed = parseIntSafe(endRaw);

      if (startParsed === null || endParsed === null) return false;

      const start = normalizer ? normalizer(startParsed) : startParsed;
      const end = normalizer ? normalizer(endParsed) : endParsed;

      return value >= start && value <= end;
    }

    const numericValue = parseIntSafe(part);
    if (numericValue === null) return false;

    const normalized = normalizer ? normalizer(numericValue) : numericValue;

    return normalized === value;
  };

  return values.some((item) => {
    const part = item.trim();

    if (!part) return false;

    return matchesPart(part);
  });
};

export const matchesCronPattern = (pattern: string, dateParts: TimeParts): boolean => {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, day, month, weekday] = parts;

  return (
    matchesCronSegment(minute, dateParts.minute, 0, 59) &&
    matchesCronSegment(hour, dateParts.hour, 0, 23) &&
    matchesCronSegment(day, dateParts.day, 1, 31) &&
    matchesCronSegment(month, dateParts.month, 1, 12) &&
    matchesCronSegment(weekday, dateParts.weekday, 0, 7, normalizeWeekdayValue)
  );
};

const parseTimeToMinutes = (value?: string): number | null => {
  if (!value) return null;

  const [hourRaw, minuteRaw] = value.split(':');
  const hour = Number.parseInt(hourRaw, 10);
  const minute = Number.parseInt(minuteRaw, 10);

  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
};

const isInTimeRange = (current: number, start: number, end: number): boolean => {
  if (start <= end) return current >= start && current <= end;

  // Cross-midnight range, e.g. 22:00 - 06:00
  return current >= start || current <= end;
};

export const evaluateCronJobDue = (job: AgentCronJob, now: Date): DueCheckResult => {
  const timezone = normalizeTimezone(job.timezone);
  const dateParts = getTimeParts(now, timezone);

  if (!matchesCronPattern(job.cronPattern, dateParts)) {
    return { due: false, reason: 'not_due', slotId: dateParts.slotId, timezone };
  }

  const conditions = job.executionConditions;

  if (conditions?.weekdays && conditions.weekdays.length > 0) {
    const normalizedWeekdays = conditions.weekdays.map(normalizeWeekdayValue);
    if (!normalizedWeekdays.includes(dateParts.weekday)) {
      return { due: false, reason: 'weekday_not_allowed', slotId: dateParts.slotId, timezone };
    }
  }

  const startMinute = parseTimeToMinutes(conditions?.timeRange?.start);
  const endMinute = parseTimeToMinutes(conditions?.timeRange?.end);

  if (startMinute !== null && endMinute !== null) {
    const currentMinute = dateParts.hour * 60 + dateParts.minute;
    if (!isInTimeRange(currentMinute, startMinute, endMinute)) {
      return { due: false, reason: 'time_range_not_allowed', slotId: dateParts.slotId, timezone };
    }
  }

  if (job.lastExecutedAt) {
    const lastExecutedParts = getTimeParts(new Date(job.lastExecutedAt), timezone);

    if (lastExecutedParts.slotId === dateParts.slotId) {
      return {
        due: false,
        reason: 'already_executed_this_slot',
        slotId: dateParts.slotId,
        timezone,
      };
    }
  }

  return { due: true, slotId: dateParts.slotId, timezone };
};

const buildLockKey = (jobId: string, slotId: string): string => `cron:job:${jobId}:slot:${slotId}`;

const extractCronDirectives = (content?: string | null) => {
  const text = content || '';

  const curatedSkillMatch = text.match(/use curated skill:\s*([^\n]+)/i);
  const runSkillMatch = text.match(/runSkill\(name=["']([^"']+)["']\)/i);

  const normalizedSkillName = (value?: string) => value?.trim().replace(/[.,;:]+$/, '');

  const skillName =
    normalizedSkillName(curatedSkillMatch?.[1]) || normalizedSkillName(runSkillMatch?.[1]);
  const noSearchSkill =
    /do not call searchskill|never call searchskill|donot call searchskill/i.test(text) ||
    !!skillName;
  const cloudSandboxHttpOnly = /lobe-cloud-sandbox|cloud sandbox|runcommand|run command|curl/i.test(
    text,
  );

  return {
    cloudSandboxHttpOnly,
    noSearchSkill,
    skillName,
  };
};

export const resolveCronEvalContext = (
  job: Pick<AgentCronJob, 'content' | 'description' | 'name'>,
) => {
  const directives = extractCronDirectives(job.content);

  if (!directives.skillName && !directives.noSearchSkill && !directives.cloudSandboxHttpOnly) {
    return undefined;
  }

  const lines = ['Cron execution directives (derived from task content):'];

  if (directives.skillName) {
    lines.push(
      `- Use runSkill(name="${directives.skillName}") directly when skill context is needed.`,
    );
  }

  if (directives.noSearchSkill) {
    lines.push('- Do not call searchSkill in this cron run.');
  }

  if (directives.cloudSandboxHttpOnly) {
    lines.push('- Use LobeHub Cloud Sandbox tool (identifier: lobe-cloud-sandbox) for HTTP calls.');
    lines.push('- Execute HTTP requests via lobe-cloud-sandbox.runCommand (curl) when needed.');
    lines.push(
      '- Do not use skill-level execScript fallback; use cloud sandbox runCommand instead.',
    );
  }

  return {
    envPrompt: lines.join('\n'),
  };
};

const acquireInMemoryLock = (key: string, ttlSeconds: number): boolean => {
  const now = Date.now();

  for (const [k, expiresAt] of inMemoryLockStore.entries()) {
    if (expiresAt <= now) {
      inMemoryLockStore.delete(k);
    }
  }

  if (inMemoryLockStore.has(key)) return false;

  inMemoryLockStore.set(key, now + ttlSeconds * 1000);

  return true;
};

export class AgentCronDispatcher {
  private readonly db: LobeChatDatabase;
  private readonly concurrency: number;
  private readonly lockTtlSeconds: number;
  private readonly maxJobsPerTick: number;

  constructor(db: LobeChatDatabase, options: AgentCronDispatcherOptions = {}) {
    this.db = db;
    this.concurrency =
      options.concurrency ??
      parsePositiveNumber(process.env.AGENT_CRON_DISPATCH_CONCURRENCY, DEFAULT_CONCURRENCY);
    this.lockTtlSeconds = options.lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS;
    this.maxJobsPerTick =
      options.maxJobsPerTick ??
      parsePositiveNumber(
        process.env.AGENT_CRON_DISPATCH_MAX_JOBS_PER_TICK,
        DEFAULT_MAX_JOBS_PER_TICK,
      );
  }

  private async acquireDispatchLock(jobId: string, slotId: string): Promise<boolean> {
    const key = buildLockKey(jobId, slotId);
    const redisClient = getAgentRuntimeRedisClient();

    if (!redisClient) {
      return acquireInMemoryLock(key, this.lockTtlSeconds);
    }

    const result = await redisClient.set(key, '1', 'EX', this.lockTtlSeconds, 'NX');

    return result === 'OK';
  }

  private async triggerJob(job: AgentCronJob): Promise<{ operationId: string }> {
    const prompt = job.content?.trim();

    if (!prompt) {
      throw new Error('Cron job content is empty');
    }

    const aiAgentService = new AiAgentService(this.db, job.userId);

    const result = await aiAgentService.execAgent({
      agentId: job.agentId,
      appContext: {
        groupId: job.groupId,
      },
      autoStart: true,
      cronJobId: job.id,
      evalContext: resolveCronEvalContext(job),
      prompt,
      trigger: 'cron',
      userInterventionConfig: { approvalMode: 'headless' },
    });

    if (!result.success || !result.operationId) {
      throw new Error(result.error || 'Failed to trigger agent cron execution');
    }

    await AgentCronJobModel.updateExecutionStats(this.db, job.id);

    return { operationId: result.operationId };
  }

  async dispatch(params: AgentCronDispatchParams = {}): Promise<AgentCronDispatchResult> {
    const startedAt = Date.now();
    const now = params.now ?? new Date();
    const dryRun = params.dryRun ?? false;

    const enabledJobs = await AgentCronJobModel.getEnabledJobs(this.db);
    const jobsToCheck = enabledJobs.slice(0, this.maxJobsPerTick);

    log(
      'dispatch tick started: dryRun=%s, scanned=%d, concurrency=%d',
      dryRun,
      jobsToCheck.length,
      this.concurrency,
    );

    const jobResults = await pMap(
      jobsToCheck,
      async (job) => {
        const dueCheck = evaluateCronJobDue(job, now);

        if (!dueCheck.due) {
          return {
            jobId: job.id,
            reason: dueCheck.reason,
            status: 'skipped' as const,
          };
        }

        if (dryRun) {
          return {
            jobId: job.id,
            reason: 'dry_run',
            status: 'skipped' as const,
          };
        }

        const locked = await this.acquireDispatchLock(job.id, dueCheck.slotId);

        if (!locked) {
          return {
            jobId: job.id,
            reason: 'idempotency_lock_not_acquired',
            status: 'skipped' as const,
          };
        }

        try {
          const result = await this.triggerJob(job);

          return {
            jobId: job.id,
            operationId: result.operationId,
            status: 'triggered' as const,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          log('dispatch job failed: jobId=%s, error=%s', job.id, message);

          return {
            jobId: job.id,
            reason: message,
            status: 'failed' as const,
          };
        }
      },
      { concurrency: this.concurrency },
    );

    const stats = {
      durationMs: Date.now() - startedAt,
      eligible: jobResults.filter((item) => !nonEligibleReasons.has(item.reason || '')).length,
      failed: jobResults.filter((item) => item.status === 'failed').length,
      scanned: jobsToCheck.length,
      skipped: jobResults.filter((item) => item.status === 'skipped').length,
      triggered: jobResults.filter((item) => item.status === 'triggered').length,
    };

    log(
      'dispatch tick finished: scanned=%d, triggered=%d, skipped=%d, failed=%d, duration=%dms',
      stats.scanned,
      stats.triggered,
      stats.skipped,
      stats.failed,
      stats.durationMs,
    );

    return {
      dryRun,
      jobs: jobResults,
      stats,
      tickAt: now.toISOString(),
    };
  }
}
