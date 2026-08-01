import type { WorkflowContext } from '@upstash/workflow';

import { TopicSummaryModel } from '@/database/models/topicSummary';
import { getServerDB } from '@/database/server';
import {
  type DispatchTopicAutoSummaryPayload,
  TopicAutoSummaryWorkflow,
} from '@/server/workflows/topicAutoSummary';

const DEFAULT_IDLE_MINUTES = 60;
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_MAX_TOPICS = 500;
const DEFAULT_PAGE_SIZE = 100;
const MAX_IDLE_MINUTES = 7 * 24 * 60;
const MAX_LOOKBACK_HOURS = 7 * 24;
const HARD_MAX_TOPICS = 2000;
const HARD_MAX_PAGE_SIZE = 200;

const boundedInteger = (value: number | undefined, fallback: number, max: number) =>
  Math.min(Math.max(Math.floor(value ?? fallback), 1), max);

export const dispatchTopicAutoSummary = async (
  context: WorkflowContext<DispatchTopicAutoSummaryPayload>,
) => {
  const payload = context.requestPayload ?? {};
  const now = Date.now();
  const idleMinutes = boundedInteger(payload.idleMinutes, DEFAULT_IDLE_MINUTES, MAX_IDLE_MINUTES);
  const lookbackHours = boundedInteger(
    payload.lookbackHours,
    DEFAULT_LOOKBACK_HOURS,
    MAX_LOOKBACK_HOURS,
  );
  const maxTopics = boundedInteger(payload.maxTopics, DEFAULT_MAX_TOPICS, HARD_MAX_TOPICS);
  const pageSize = boundedInteger(payload.pageSize, DEFAULT_PAGE_SIZE, HARD_MAX_PAGE_SIZE);
  const processed = Math.max(payload.processed ?? 0, 0);
  const remaining = Math.max(maxTopics - processed, 0);
  if (remaining === 0) return { processed, scheduled: 0, truncated: true };

  const candidates = await context.run(
    `topic-auto-summary:list:${payload.cursor?.id ?? 'root'}`,
    async () => {
      const db = await getServerDB();
      return new TopicSummaryModel(db).listCandidates({
        cursor: payload.cursor
          ? {
              id: payload.cursor.id,
              lastMessageUpdatedAt: new Date(payload.cursor.lastMessageUpdatedAt),
            }
          : undefined,
        force: payload.force,
        idleBefore: new Date(now - idleMinutes * 60_000),
        limit: Math.min(pageSize, remaining),
        topicCreatedAfter: new Date(now - lookbackHours * 3_600_000),
      });
    },
  );

  if (payload.dryRun) {
    return { candidates: candidates.length, dryRun: true, processed, scheduled: 0 };
  }

  await Promise.all(
    candidates.map((candidate) =>
      context.run(`topic-auto-summary:schedule:${candidate.id}`, () =>
        TopicAutoSummaryWorkflow.triggerExecute({
          force: payload.force,
          topicId: candidate.id,
          userId: candidate.userId,
          workspaceId: candidate.workspaceId ?? undefined,
        }),
      ),
    ),
  );

  const nextProcessed = processed + candidates.length;
  const last = candidates.at(-1);
  const hasNextPage =
    candidates.length === Math.min(pageSize, remaining) && nextProcessed < maxTopics;
  if (last && hasNextPage) {
    await context.run(`topic-auto-summary:next:${last.id}`, () =>
      TopicAutoSummaryWorkflow.triggerDispatch({
        ...payload,
        cursor: {
          id: last.id,
          lastMessageUpdatedAt: last.lastMessageUpdatedAt.toISOString(),
        },
        processed: nextProcessed,
      }),
    );
  }

  return { hasNextPage, processed: nextProcessed, scheduled: candidates.length };
};

export const dispatchTopicAutoSummaryOptions = {
  flowControl: { key: 'topic-auto-summary.dispatch', parallelism: 1, ratePerSecond: 1 },
};
