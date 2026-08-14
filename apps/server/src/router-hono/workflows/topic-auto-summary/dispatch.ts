import type { WorkflowContext } from '@upstash/workflow';

import { TopicSummaryModel } from '@/database/models/topicSummary';
import { getServerDB } from '@/database/server';
import { parseWorkflowDate, runStep } from '@/server/workflows/step';
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

  // `runStep` types the result the way the workflow receives it after Upstash's JSON round trip, so
  // `lastMessageUpdatedAt` reads as the ISO string it actually is rather than the model's `Date`.
  const listCandidates = async (cursor: DispatchTopicAutoSummaryPayload['cursor'], limit: number) =>
    runStep(context, `topic-auto-summary:list:${cursor?.id ?? 'root'}`, async () => {
      const db = await getServerDB();

      return new TopicSummaryModel(db).listCandidates({
        cursor: cursor
          ? {
              id: cursor.id,
              lastMessageUpdatedAt: parseWorkflowDate(
                cursor.lastMessageUpdatedAt,
                'Invalid topic auto summary cursor timestamp',
              ),
            }
          : undefined,
        force: payload.force,
        idleBefore: new Date(now - idleMinutes * 60_000),
        limit,
        topicCreatedAfter: new Date(now - lookbackHours * 3_600_000),
      });
    });

  if (payload.dryRun) {
    let candidates = 0;
    let cursor = payload.cursor;
    let hasNextPage = false;

    while (candidates < remaining) {
      const limit = Math.min(pageSize, remaining - candidates);
      const page = await listCandidates(cursor, limit);
      candidates += page.length;
      hasNextPage = page.length === limit;
      const last = page.at(-1);
      if (last && hasNextPage)
        cursor = {
          id: last.id,
          lastMessageUpdatedAt: last.lastMessageUpdatedAt,
        };
      if (!last || !hasNextPage || candidates === remaining) break;
    }

    const truncated =
      candidates === remaining && hasNextPage
        ? (await listCandidates(cursor, 1)).length > 0
        : false;

    return {
      candidates,
      dryRun: true,
      processed,
      scheduled: 0,
      truncated,
    };
  }

  const candidates = await listCandidates(payload.cursor, Math.min(pageSize, remaining));

  await Promise.all(
    candidates.map((candidate) =>
      runStep(context, `topic-auto-summary:schedule:${candidate.id}`, () =>
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
    await runStep(context, `topic-auto-summary:next:${last.id}`, () =>
      TopicAutoSummaryWorkflow.triggerDispatch({
        ...payload,
        cursor: {
          id: last.id,
          lastMessageUpdatedAt: last.lastMessageUpdatedAt,
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
