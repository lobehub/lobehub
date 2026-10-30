import {
  deriveOperationEditedFiles,
  deriveOperationGoals,
  type OperationEditedFile,
  type OperationGoal,
} from '@lobechat/builtin-tools/operationArtifacts';
import { LOADING_FLAT } from '@lobechat/const';
import {
  type ConversationTailKind,
  findLatestWorkRootOperationId,
  getOperationFinalRootId,
  parse,
  resolveConversationTail,
} from '@lobechat/conversation-flow';
import type { AssistantContentBlock, UIChatMessage, WorkSummaryItem } from '@lobechat/types';
import { z } from 'zod';

import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

import { readMessagesByCursor } from './messagesByCursor';

// The chat head page's budget; the preview reads the same page so its message
// matches the row the real list renders.
const HEAD_PAGE_ROW_BUDGET = 50;

export const topicPreviewsInputSchema = z.object({
  agentId: z.string().nullish(),
  groupId: z.string().nullish(),
  topicIds: z.array(z.string().min(1)).min(1).max(5),
});

export interface TopicPreviewTimelineRow {
  createdAt: Date | number | string;
  finishType?: string;
  id: string;
  updatedAt: Date | number | string;
}

export type TopicPreviewSkipReason =
  'disabled' | 'notFinalAnswer' | 'notFound' | 'running' | 'unsupported' | 'waitingForHuman';

export type TopicPreviewItem =
  | {
      blocks: AssistantContentBlock[];
      editedFiles: OperationEditedFile[];
      goals: OperationGoal[];
      kind: ConversationTailKind;
      // The rows above the answer, sent only when this round is the whole topic:
      // the list then top-aligns them instead of filling the screen with history.
      leading: UIChatMessage[] | null;
      message: UIChatMessage;
      status: 'ok';
      timeline: TopicPreviewTimelineRow[];
      topicId: string;
      topicUpdatedAt: string;
      workRootOperationId: string | null;
      works: WorkSummaryItem[];
    }
  | { reason: TopicPreviewSkipReason; status: 'skipped'; topicId: string };

interface TopicPreviewsContext {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

const skipped = (topicId: string, reason: TopicPreviewSkipReason): TopicPreviewItem => ({
  reason,
  status: 'skipped',
  topicId,
});

const isFinalAnswer = (message: UIChatMessage | undefined) =>
  message?.role === 'assistant' &&
  !message.tools?.length &&
  !message.error &&
  !!message.content &&
  message.content !== LOADING_FLAT;

const findWorks = (messages: UIChatMessage[], rootOperationId: string | undefined) => {
  if (!rootOperationId) return [];
  const anchor = messages.find(
    (message) =>
      !!message.works?.length &&
      (getOperationFinalRootId(message.metadata) ?? message.works[0].event.rootOperationId) ===
        rootOperationId,
  );
  return anchor?.works ?? [];
};

const readTopicPreview = async (
  ctx: TopicPreviewsContext,
  agentId: string | null | undefined,
  topic: { id: string; updatedAt: Date },
): Promise<TopicPreviewItem> => {
  const page = await readMessagesByCursor(ctx, {
    agentId,
    countBudget: HEAD_PAGE_ROW_BUDGET,
    includeFileWorks: true,
    projectToolPayloads: true,
    roundLimit: 1,
    topicId: topic.id,
  });
  const tail = resolveConversationTail(page.messages);
  if (!tail) return skipped(topic.id, 'notFound');

  // A steered round renders as one chain across several groups, so its cards
  // aggregate blocks this single-group derivation would miss.
  if (page.messages.some((message) => message.role === 'user' && message.metadata?.steer)) {
    return skipped(topic.id, 'unsupported');
  }

  const children = (tail.kind === 'group' ? tail.message.children : undefined) ?? [];
  const leading = page.nextCursor ? null : parse(page.messages).flatList.slice(0, -1);
  const finalId = tail.kind === 'group' ? children.at(-1)?.id : tail.message.id;
  const message = page.messages.find((item) => item.id === finalId);
  if (!isFinalAnswer(message) || !message) return skipped(topic.id, 'notFinalAnswer');

  const taskCompletions = tail.message.taskCompletions as AssistantContentBlock[] | undefined;
  const workRootOperationId = findLatestWorkRootOperationId(
    tail.message.metadata,
    children,
    taskCompletions,
  );

  return {
    blocks: children,
    editedFiles: deriveOperationEditedFiles(children, !!workRootOperationId),
    goals: deriveOperationGoals(children),
    kind: tail.kind,
    leading: leading as UIChatMessage[] | null,
    message,
    status: 'ok',
    timeline: page.messages.map(({ createdAt, id, metadata, updatedAt }) => ({
      createdAt,
      finishType: typeof metadata?.finishType === 'string' ? metadata.finishType : undefined,
      id,
      updatedAt,
    })),
    topicId: topic.id,
    topicUpdatedAt: topic.updatedAt.toISOString(),
    workRootOperationId: workRootOperationId ?? null,
    works: findWorks(page.messages, workRootOperationId),
  };
};

// First version: reads each topic's head page through the chat read pipeline,
// so `message` matches the real list by construction. The backend replaces the
// internals with a final-answer-only read before `topic_preview` is turned on.
export const readTopicPreviews = async (
  ctx: TopicPreviewsContext,
  { agentId, groupId, topicIds }: z.infer<typeof topicPreviewsInputSchema>,
): Promise<TopicPreviewItem[]> => {
  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(ctx.userId);
  if (!featureFlags.enableTopicPreview) return topicIds.map((id) => skipped(id, 'disabled'));
  if (groupId) return topicIds.map((id) => skipped(id, 'unsupported'));

  const topicModel = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
  const rows = await topicModel.findByIds(topicIds);
  const topicsById = new Map(rows.map((row) => [row.id, row]));

  // One head read at a time: a batch must not multiply the per-request DB load.
  const items: TopicPreviewItem[] = [];
  for (const topicId of topicIds) {
    const topic = topicsById.get(topicId);
    if (!topic || (agentId && topic.agentId && topic.agentId !== agentId)) {
      items.push(skipped(topicId, 'notFound'));
    } else if (topic.groupId) {
      items.push(skipped(topicId, 'unsupported'));
    } else if (topic.status === 'running' || topic.status === 'waitingForHuman') {
      items.push(skipped(topicId, topic.status));
    } else {
      items.push(await readTopicPreview(ctx, agentId, topic));
    }
  }
  return items;
};
