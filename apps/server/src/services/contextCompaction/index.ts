import { getCompressionThreshold } from '@lobechat/agent-runtime';
import { countContextTokens } from '@lobechat/context-engine';
import { consumeStreamUntilDone, getModelPropertyWithFallback } from '@lobechat/model-runtime';
import { chainCompressContext } from '@lobechat/prompts';
import type { UIChatMessage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { CompressionRepository } from '@/database/repositories/compression';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentService } from '@/server/services/agent';
import { MessageService } from '@/server/services/message';

const log = debug('lobe-server:context-compaction');

/**
 * `MessageModel.query` returns the newest page only (1,000 rows). Walking older
 * pages is capped so a runaway topic fails loudly instead of being compacted in part.
 */
const MAX_HISTORY_PAGES = 20;

const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;
  const error = new Error('Context compaction cancelled');
  error.name = 'AbortError';
  throw error;
};

const estimateTokens = (message: UIChatMessage): number =>
  countContextTokens({ messages: [message] }).adjustedTotal;

/**
 * Split messages, in order, into chunks whose estimated size stays within
 * `budget`. A single message larger than the budget becomes its own chunk.
 */
export const chunkByTokenBudget = (
  messages: UIChatMessage[],
  budget: number,
): UIChatMessage[][] => {
  const chunks: UIChatMessage[][] = [];
  let current: UIChatMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const tokens = estimateTokens(message);
    if (current.length > 0 && currentTokens + tokens > budget) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(message);
    currentTokens += tokens;
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  const message = (error as { message?: unknown } | undefined)?.message;
  if (typeof message === 'string' && message) return message;
  return `Context compaction stream failed: ${JSON.stringify(error)}`;
};

export interface CompactContextParams {
  agentId: string;
  groupId?: string | null;
  threadId?: string | null;
  topicId: string;
}

export interface CompactContextResult {
  messageGroupId?: string;
  messages: UIChatMessage[];
  /** Nothing left to compact, or the agent has no model to summarize with. */
  skipped: boolean;
}

/**
 * Server-side manual context compaction (`/compact`).
 *
 * Mirrors the runtime `compress_context` executor so a conversation compacted by
 * hand ends up in the same persisted shape as one compacted automatically: every
 * live top-level message goes into one new `compressedGroup`, the summaries of
 * earlier groups are folded into the prompt, and those earlier groups are
 * replaced atomically when the new summary is finalized. The summary model call
 * runs here, so the browser only triggers the operation and adopts the result.
 */
export class ContextCompactionService {
  private readonly agentService: AgentService;
  private readonly compressionRepository: CompressionRepository;
  private readonly messageService: MessageService;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.agentService = new AgentService(db, userId, workspaceId);
    this.compressionRepository = new CompressionRepository(db, userId, workspaceId);
    this.messageService = new MessageService(db, userId, workspaceId);
  }

  async compact(
    params: CompactContextParams,
    options: { signal?: AbortSignal } = {},
  ): Promise<CompactContextResult> {
    const { signal } = options;
    const { agentId, groupId, threadId, topicId } = params;
    const scope = { agentId, groupId, threadId, topicId };

    const messages = await this.queryFullHistory(scope);

    const topicGroups = messages.filter((message) => message.role === 'compressedGroup');
    // A thread read also returns the main-line parents it branched from; those
    // belong to the main line and must stay there, so only the thread's own
    // messages are compacted (and summarized) here.
    const liveMessages = messages.filter(
      (message) =>
        message.role !== 'compressedGroup' && (!threadId || message.threadId === threadId),
    );
    const messageIds = liveMessages.map((message) => message.id);

    if (messageIds.length === 0) {
      log('skip topic=%s: no uncompressed messages', topicId);
      return { messages, skipped: true };
    }

    const agent = await this.agentService.getAgentConfigById(agentId);
    const model = agent?.model;
    const provider = agent?.provider;

    if (!model || !provider) {
      log('skip topic=%s: agent %s has no model/provider', topicId, agentId);
      return { messages, skipped: true };
    }

    // Group nodes are listed per topic, not per thread: fold in and supersede
    // only the groups of the scope being compacted, never a sibling thread's.
    const sourceGroupIds = await this.compressionRepository.filterGroupIdsByThread(
      topicGroups.map((message) => message.id),
      { threadId, topicId },
    );
    const sourceGroups = topicGroups.filter((message) => sourceGroupIds.includes(message.id));
    const existingSummary = sourceGroups
      .map((message) => (typeof message.content === 'string' ? message.content.trim() : ''))
      .filter(Boolean)
      .join('\n\n');

    // Write through the repository: the MessageService wrappers re-read the list
    // after every write, outside this rollback, and their reads cover only the
    // newest page anyway. The summary comes from the full history collected above.
    const messageGroupId = await this.compressionRepository.createCompressionGroup({
      content: '...',
      messageIds,
      metadata: { originalMessageCount: messageIds.length },
      topicId,
    });

    try {
      const summary = await this.summarizeInChunks({
        existingSummary: existingSummary || undefined,
        messages: liveMessages,
        model,
        provider,
        signal,
      });

      if (!summary) throw new Error('Context compaction produced an empty summary');
      // A caller that gave up must not see its cancelled compaction reappear on refresh.
      throwIfAborted(signal);

      await this.compressionRepository.finalizeCompressionGroup({
        content: summary,
        groupId: messageGroupId,
        sourceGroupIds,
        topicId,
      });

      // Read the settled list inside the rollback: a group the read path cannot
      // render must not stay persisted and make the whole topic unreadable.
      const settled = await this.messageService.queryMessages(scope);

      return { messageGroupId, messages: settled, skipped: false };
    } catch (error) {
      // Never leave the conversation behind a placeholder `...` group. Deleting
      // the group returns its members, including any merged from earlier groups,
      // to the live history.
      await this.compressionRepository
        .deleteCompressionGroup(messageGroupId)
        .catch((rollbackError) => {
          console.error('[ContextCompaction] rollback failed: %O', rollbackError);
        });
      throw error;
    }
  }

  /**
   * Every top-level message in scope, oldest first. Walks the round cursor
   * (`before`) from the newest page back until a page adds nothing older.
   * Full tool payloads: the summary must see what the model saw.
   */
  private async queryFullHistory(scope: CompactContextParams): Promise<UIChatMessage[]> {
    const pages: UIChatMessage[][] = [];
    const seen = new Set<string>();
    let before: { createdAt: Date; id: string } | undefined;

    // One read past the cap is the sentinel: exhaustion is only observable by
    // asking the cursor once more, so a history of exactly the cap still passes.
    for (let pageIndex = 0; pageIndex <= MAX_HISTORY_PAGES; pageIndex++) {
      const page = await this.messageService.queryMessages(
        { ...scope, before },
        { skipToolProjection: true },
      );
      const fresh = page.filter((message) => !seen.has(message.id));
      for (const message of fresh) seen.add(message.id);

      // Each page is ascending, so its first raw row is the next cursor.
      const oldest = fresh.find((message) => message.role !== 'compressedGroup');
      if (!oldest) {
        if (fresh.length > 0) pages.unshift(fresh);
        return pages.flat();
      }
      if (pageIndex === MAX_HISTORY_PAGES) break;

      pages.unshift(fresh);
      before = { createdAt: new Date(oldest.createdAt), id: oldest.id };
    }

    throw new Error(
      `Context compaction aborted: topic ${scope.topicId} exceeds ${MAX_HISTORY_PAGES} history pages`,
    );
  }

  /**
   * A whole multi-page history can far exceed the model's window, so it is
   * summarized as a rolling chain: each chunk stays within the same budget the
   * runtime uses to trigger compaction, and carries the previous summary forward.
   */
  private async summarizeInChunks(params: {
    existingSummary?: string;
    messages: UIChatMessage[];
    model: string;
    provider: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { messages, model, provider, signal } = params;
    const contextWindowTokens = await getModelPropertyWithFallback<number | undefined>(
      model,
      'contextWindowTokens',
      provider,
    ).catch(() => undefined);
    const budget = getCompressionThreshold({ maxWindowToken: contextWindowTokens || undefined });

    let summary = params.existingSummary;
    for (const chunk of chunkByTokenBudget(messages, budget)) {
      summary = await this.summarize({
        existingSummary: summary,
        messages: chunk,
        model,
        provider,
        signal,
      });
      if (!summary) return '';
    }

    return summary ?? '';
  }

  private async summarize(params: {
    existingSummary?: string;
    messages: UIChatMessage[];
    model: string;
    provider: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { existingSummary, messages, model, provider, signal } = params;
    const payload = chainCompressContext(messages, existingSummary);
    const runtime = await initModelRuntimeFromDB(this.db, this.userId, provider, this.workspaceId);

    let content = '';
    let streamError: unknown;
    const response = await runtime.chat(
      { messages: payload.messages as any[], model, stream: true },
      {
        callback: {
          // In-band stream errors do not reject the stream; without this a truncated
          // partial summary would be finalized and replace the earlier groups.
          onError: (error) => {
            streamError = error;
          },
          onText: (text) => {
            content += text;
          },
        },
        metadata: { trigger: RequestTrigger.ContextCompression },
        signal,
      },
    );
    await consumeStreamUntilDone(response);

    throwIfAborted(signal);
    if (streamError) throw new Error(getErrorMessage(streamError));

    return content.trim();
  }
}
