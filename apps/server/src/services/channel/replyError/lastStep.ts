import { and, desc, eq, gte } from 'drizzle-orm';

import type { ChannelReplyErrorFacts } from '@/database/repositories/channel';
import { messagePlugins, messages } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

const toolName = (tool: unknown) => {
  if (!tool || typeof tool !== 'object') return;
  const { apiName, identifier } = tool as { apiName?: unknown; identifier?: unknown };
  return [identifier, apiName].filter((part) => typeof part === 'string' && part).join('.');
};

const ago = (at: Date, now: number) => {
  const minutes = Math.max(0, Math.round((now - at.getTime()) / 60_000));
  return minutes < 1 ? 'just now' : `${minutes} min before it stopped`;
};

/**
 * The last thing the failed run left in its topic, in plain words for the summarizer: no events at
 * all, a tool call that never returned, a tool result with no next step, or text it was writing.
 * One indexed read of the topic's newest message since the run started.
 */
export const describeLastStep = async (
  db: LobeChatDatabase,
  facts: ChannelReplyErrorFacts,
  now = Date.now(),
): Promise<string> => {
  const operation = facts.operation;
  if (!operation?.topicId || !operation.startedAt) return 'the run never started';

  const [last] = await db
    .select({
      apiName: messagePlugins.apiName,
      content: messages.content,
      createdAt: messages.createdAt,
      identifier: messagePlugins.identifier,
      role: messages.role,
      tools: messages.tools,
    })
    .from(messages)
    .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
    .where(
      and(eq(messages.topicId, operation.topicId), gte(messages.createdAt, operation.startedAt)),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!last || last.role === 'user') return 'no events at all after it started';

  const when = ago(last.createdAt, now);
  if (last.role === 'tool') {
    const name = toolName(last) || 'a tool';
    return `tool ${name} returned a result (${when}), but no next step followed`;
  }
  const tools = Array.isArray(last.tools) ? last.tools : [];
  if (tools.length) {
    const name = toolName(tools.at(-1)) || 'a tool';
    return `it called tool ${name} (${when}) and the tool never returned`;
  }
  return last.content?.trim()
    ? `it was writing its answer (${when})`
    : `the model was thinking (${when}) and produced nothing`;
};
