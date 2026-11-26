import { ThreadType } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { threads } from '@/database/schemas';
import { buildWorkspaceWhere } from '@/database/utils/workspace';

import type { EvalRunDeps } from './types';

/** How deep sub-agents may nest inside one attempt (a sub-agent of a sub-agent …). */
const MAX_SUB_AGENT_DEPTH = 4;

interface AttemptMessage {
  id: string;
  /** Set on a sub-agent's message: the isolation thread it ran in, by title. */
  via?: string;
}

/**
 * An attempt's messages with the messages of the sub-agents it started laid in
 * after the tool message that started each one, nested sub-agents included.
 * A sub-agent runs in an isolation thread of the attempt's topic, hanging off
 * that tool message; the attempt's own message list never contains it, so a
 * judge reading only that list cannot see what the sub-agent did.
 */
export const withSubAgentMessages = async <T extends AttemptMessage>(
  deps: Pick<EvalRunDeps, 'db' | 'messageModel' | 'userId' | 'workspaceId'>,
  params: { messages: T[]; topicId: string },
): Promise<T[]> => {
  const isolation = await deps.db
    .select({ id: threads.id, sourceMessageId: threads.sourceMessageId, title: threads.title })
    .from(threads)
    .where(
      and(
        eq(threads.topicId, params.topicId),
        eq(threads.type, ThreadType.Isolation),
        buildWorkspaceWhere({ userId: deps.userId, workspaceId: deps.workspaceId }, threads),
      ),
    );
  if (isolation.length === 0) return params.messages;

  const bySource = new Map<string, typeof isolation>();
  for (const thread of isolation) {
    if (!thread.sourceMessageId) continue;
    bySource.set(thread.sourceMessageId, [...(bySource.get(thread.sourceMessageId) ?? []), thread]);
  }

  const expand = async (list: T[], depth: number): Promise<T[]> => {
    const out: T[] = [];
    for (const message of list) {
      out.push(message);
      if (depth >= MAX_SUB_AGENT_DEPTH) continue;
      for (const thread of bySource.get(message.id) ?? []) {
        const own = (await deps.messageModel.query({
          threadId: thread.id,
          topicId: params.topicId,
        })) as unknown as T[];
        const label = thread.title || 'sub-agent';
        const nested = await expand(
          own.map((item) => ({ ...item, via: item.via ?? label })),
          depth + 1,
        );
        out.push(...nested);
      }
    }
    return out;
  };

  return expand(params.messages, 0);
};
