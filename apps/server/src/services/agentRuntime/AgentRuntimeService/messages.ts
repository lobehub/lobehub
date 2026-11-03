import type { AgentState } from '@lobechat/agent-runtime';
import { parse } from '@lobechat/conversation-flow';
import { type ChatToolPayload, type UIChatMessage } from '@lobechat/types';

import { hasNonPersistedMessage } from '@/server/modules/AgentRuntime/messagePersistence';
import { FileService } from '@/server/services/file';
import { resolveRunWorkAccessScope } from '@/server/services/workRegistration';

import { resolveMessageFileUrls } from '../../message/resolveMessageFileUrls';
import {
  extractTextFromMessage,
  findLastAssistantMessage,
  normalizeCompletionMessages,
} from '../CompletionLifecycle';
import type { AgentRuntimeServiceContext } from './types';

/** What this module reads off the service. */
export type MessagesDeps = Pick<
  AgentRuntimeServiceContext,
  'messageModel' | 'messageService' | 'queryMessagesFromDB' | 'serverDB' | 'userId'
>;

/**
 * Query the canonical UIChatMessage[] snapshot for the active topic — the
 * same shape the `message.getMessages` trpc lambda returns to the client.
 * Attached to step_start / agent_runtime_end stream events so the client
 * can use the pushed payload directly instead of refetching from DB.
 *
 * Returns undefined when the topic isn't known yet (e.g. very early in
 * bootstrap before the topic row has been committed) so callers can skip
 * the `uiMessages` field entirely instead of pushing an empty array.
 */
export async function queryUiMessages(
  deps: MessagesDeps,
  agentState: AgentState,
  options?: {
    /**
     * Skip the Work-summary assembly for mid-stream (step_start) snapshots —
     * each step would otherwise re-run the per-type Work queries. Terminal
     * (agent_runtime_end) snapshots keep works so the settled message list
     * carries the round's Work chips. The client preserves previously
     * rendered works when applying a skipped snapshot (`preserveWorks`).
     */
    skipWorks?: boolean;
  },
): Promise<UIChatMessage[] | undefined> {
  const agentId: string | undefined = agentState?.origin?.agentId;
  const topicId: string | undefined = agentState?.origin?.topicId;
  // groupId scopes group conversations. Without it the query falls into the
  // standard branch (`groupId IS NULL`) and returns ZERO group messages, so
  // the step_start uiMessages snapshot would be empty and clobber the client.
  const groupId: string | undefined = agentState?.origin?.groupId;
  // threadId scopes a subtopic run. Without it the snapshot is the topic's
  // MAIN conversation, and the client writes that into the thread's bucket at
  // step_start / agent_runtime_end — wiping the turn the run just produced, so
  // the subtopic panel falls back to showing the main conversation.
  const threadId: string | undefined = agentState?.origin?.threadId ?? undefined;
  if (!agentId || !topicId) return undefined;

  // A share visitor's Works are registered under the visitor's share scope
  // (`registerFileWorks`), which the ordinary scope never resolves — without
  // it the terminal snapshot carries no Work card and the visitor only sees
  // it after a reload through `shareChat.getMessages`. The visitor surface
  // always opts in to file Works on that read path, and visitor runs never
  // use message patches, so this snapshot only ever reaches that client.
  const workAccessScope = resolveRunWorkAccessScope({
    shareVisitor: agentState?.principal?.actor?.shareVisitor,
    topicId,
  });
  const isShareVisitorRun = !!workAccessScope;
  // `file` Works stay out of the push unless the receiving client declared
  // it renders them: released desktop builds crash on the unknown type.
  const includeFileWorks = isShareVisitorRun || agentState?.host?.acceptsFileWorks === true;

  try {
    return await deps.messageService.queryMessages(
      {
        agentId,
        groupId,
        ...(includeFileWorks && { includeFileWorks: true }),
        skipWorks: options?.skipWorks,
        threadId,
        topicId,
      },
      // The run's own topic is already resolved and authorized; an agent-share
      // visitor run executes under the CREATOR's identity, so without this the
      // creator-facing exclusion in `MessageModel.query()` returns an EMPTY
      // snapshot for the visitor's topic, and the client applies it as the
      // terminal Source of Truth — wiping the conversation the run just
      // produced. Visitor-facing redaction of the pushed snapshot happens in
      // `GatewayStreamNotifier`.
      { allowShareVisitor: true, ...(workAccessScope && { workAccessScope }) },
    );
  } catch (error) {
    // Stream events must never fail the step. If the DB hiccups, fall back
    // to letting the client refresh as before.
    console.error('[queryUiMessages] Failed to load uiMessages snapshot: %O', error);
    return undefined;
  }
}

/** Native harness + Gateway mux is the only producer of message patches. */
/**
 * Whether this run reconciles the client's message list through
 * `message_patch` revisions instead of pushing whole `uiMessages` snapshots.
 *
 * Decided by the capability the starting client declared when the operation
 * was created (`host.clientProtocol`), NOT by a user preference: the run is
 * delivered to whatever bundle that client is, and a desktop build older than
 * `message_patch` would drop every mid-run reconciliation it was sent.
 *
 * A share visitor is always excluded — the visitor surface has no
 * owner-scoped read to reconcile against.
 */
export function usesGatewayMessagePatch(agentState: AgentState): boolean {
  if (agentState.principal?.actor?.shareVisitor) return false;
  return agentState.host?.clientProtocol === 2;
}

export async function queryMessagesFromDB(deps: MessagesDeps, state: AgentState) {
  let postProcessUrl: ((path: string | null) => Promise<string>) | undefined;
  try {
    const fileService = new FileService(deps.serverDB, deps.userId);
    postProcessUrl = (path: string | null) => fileService.getFullFileUrl(path);
  } catch {
    postProcessUrl = undefined;
  }

  // MODEL, not `messageService.queryMessages`: this read feeds the LLM
  // context and must keep every tool result whole. The service read path may
  // reduce tool payloads to render-facing view models (see
  // `@lobechat/tool-view-model`), which would silently strip the results the
  // model is supposed to remember.
  return deps.messageModel.query(
    {
      agentId: state.origin?.agentId,
      // Group runs must pass groupId, else the query filters `groupId IS NULL`
      // and returns no group messages — the next LLM step then gets an empty
      // context and the provider rejects it ("at least one message is required").
      groupId: state.origin?.groupId,
      threadId: state.origin?.threadId,
      topicId: state.origin?.topicId,
    },
    // The run's own topic is already resolved and authorized; an agent-share
    // visitor run executes under the CREATOR's identity, so it must opt out
    // of `query()`'s creator-facing agent-share exclusion.
    { allowShareVisitor: true, postProcessUrl },
  );
}

/**
 * Reload the conversation messages from the database and flatten them for the
 * runtime. Used when resuming a parked op so the next LLM step sees tool
 * results written out-of-band (e.g. by a sub-agent completion bridge).
 */
export async function refreshMessagesFromDB(
  deps: MessagesDeps,
  state: AgentState,
): Promise<AgentState['messages']> {
  const dbMessages = await deps.queryMessagesFromDB(state);

  const { flatList } = parse(dbMessages, undefined, { threadId: state.origin?.threadId });
  return flatList as AgentState['messages'];
}

/**
 * Use conversation-flow to select the active final assistant leaf, then
 * recover that leaf from the original query result. FlatListBuilder moves
 * child metadata onto its display-only group/first child, so the parsed leaf
 * alone cannot reliably identify serialized multimodal content.
 */
export async function resolveLastAssistantMessageFromDB(
  deps: MessagesDeps,
  state: AgentState,
): Promise<unknown> {
  const dbMessages = await deps.queryMessagesFromDB(state);
  const { flatList } = parse(dbMessages, undefined, { threadId: state.origin?.threadId });
  const lastAssistant = findLastAssistantMessage(normalizeCompletionMessages(flatList));
  const lastAssistantId = typeof lastAssistant?.id === 'string' ? lastAssistant.id : undefined;

  return (
    (lastAssistantId ? dbMessages.find((message) => message.id === lastAssistantId) : undefined) ??
    lastAssistant
  );
}

/**
 * Fallback content resolution for a heterogeneous (CLI-driven) sub-agent
 * child in queue mode. `coordinator.loadAgentState`/`finalState` is always
 * empty here: a hetero run never writes into the Redis-backed runtime state
 * this class's step loop maintains (only `saveAgentState` calls under the
 * homogeneous step loop populate it), and the completion webhook's
 * `eventFields` deliberately excludes `lastAssistantContent` to keep the
 * QStash payload lean (see `createSubAgentBridgeHook`'s doc comment) —
 * `heteroFinish` already resolves the real answer server-side before
 * dispatching, but that resolution never reaches this callback.
 *
 * The child's own conversation is queryable directly by its isolation
 * `threadId` regardless — the same source `heteroFinish` itself reads via
 * `heteroCurrentMsgId` before completion. Scoping by `threadId` alone is
 * sufficient: thread ids are unique, so no `agentId`/`topicId` is needed to
 * disambiguate.
 */
export async function resolveLastAssistantContentFromThread(
  deps: MessagesDeps,
  threadId: string,
): Promise<string | undefined> {
  const messages = await deps.messageModel.query({ threadId }, { allowShareVisitor: true });
  const lastAssistant = findLastAssistantMessage(normalizeCompletionMessages(messages));
  return extractTextFromMessage(lastAssistant) || undefined;
}

/**
 * Overwrite `state.messages` in place with the canonical DB conversation at
 * step entry, making the DB the single source of truth for messages.
 *
 * Guarded against regressions:
 * - Ops carrying a non-persisted (ephemeral / suppressed) message — e.g. the
 *   group-member supervisor instruction, which has no DB row — keep their
 *   full working set in Redis (see `AgentStateManager.serializeStateForPersist`),
 *   so leave the loaded array intact instead of clobbering it with a DB-only
 *   view that would drop the prompt.
 * - `state.messages` is guaranteed to end up an array, so a missing-identifier
 *   early return or an empty/failed read never hands `undefined` to downstream
 *   consumers (e.g. `shouldCompress(state.messages)`).
 * - A populated working set is never replaced with an empty one or on a DB
 *   error, so a transient read miss can't blank the conversation mid-op.
 * Reads once for UI, model hydration and same-step device discovery.
 * Undefined rows mean the read was skipped or failed; [] is a successful read.
 */
export async function queryStepEntryMessages(
  deps: MessagesDeps,
  state: AgentState,
): Promise<{
  messages?: UIChatMessage[];
  uiMessages?: UIChatMessage[];
}> {
  if (!Array.isArray(state.messages)) state.messages = [];
  if (!state.origin?.agentId || !state.origin?.topicId) return {};

  let messages: UIChatMessage[];
  try {
    // Keep full tool payloads and raw attachment paths. Each consumer derives
    // its own view; mid-stream Work summaries are not used by the runtime.
    messages = await deps.messageModel.query(
      {
        agentId: state.origin.agentId,
        groupId: state.origin.groupId,
        skipWorks: true,
        threadId: state.origin.threadId,
        topicId: state.origin.topicId,
      },
      { allowShareVisitor: true },
    );
  } catch (error) {
    console.error('[queryStepEntryMessages] Failed to load messages: %O', error);
    return {};
  }

  const [uiResult] = await Promise.all([
    (async () => {
      try {
        return await deps.messageService.prepareUiMessages(messages);
      } catch (error) {
        console.error('[queryStepEntryMessages] Failed to prepare UI messages: %O', error);
        return undefined;
      }
    })(),
    (async () => {
      // Transient/id-less input must not be replaced by persisted history.
      if (hasNonPersistedMessage(state.messages)) return;
      try {
        let fileService: FileService | undefined;
        try {
          fileService = new FileService(deps.serverDB, deps.userId);
        } catch (error) {
          // Match the model read's fallback when file storage is unavailable.
          console.error('[queryStepEntryMessages] File service unavailable: %O', error);
        }
        const resolved = fileService
          ? await resolveMessageFileUrls(messages, (file) => fileService!.getFullFileUrl(file.url))
          : messages;
        const { flatList } = parse(resolved, undefined, { threadId: state.origin?.threadId });
        if (flatList.length > 0) state.messages = flatList as AgentState['messages'];
      } catch (error) {
        console.error('[queryStepEntryMessages] Failed to hydrate runtime messages: %O', error);
      }
    })(),
  ]);
  return { messages, uiMessages: uiResult };
}

export function resolveAsyncToolResumeParentMessageId(
  messages: AgentState['messages'],
  pendingTools: ChatToolPayload[],
): string | undefined {
  const fallbackParentMessageId = messages.at(-1)?.id;
  if (pendingTools.length === 0) return fallbackParentMessageId;

  const toolResultMessageIds = new Map<string, string>();

  const collectToolResultIds = (message: unknown) => {
    if (!message || typeof message !== 'object') return;

    const candidate = message as {
      children?: unknown;
      id?: unknown;
      tool_call_id?: unknown;
      tools?: unknown;
    };

    if (typeof candidate.tool_call_id === 'string' && typeof candidate.id === 'string') {
      toolResultMessageIds.set(candidate.tool_call_id, candidate.id);
    }

    if (Array.isArray(candidate.tools)) {
      for (const tool of candidate.tools) {
        if (!tool || typeof tool !== 'object') continue;

        const toolPayload = tool as { id?: unknown; result_msg_id?: unknown };
        if (typeof toolPayload.id === 'string' && typeof toolPayload.result_msg_id === 'string') {
          toolResultMessageIds.set(toolPayload.id, toolPayload.result_msg_id);
        }
      }
    }

    if (Array.isArray(candidate.children)) {
      for (const child of candidate.children) {
        collectToolResultIds(child);
      }
    }
  };

  for (const message of messages) {
    collectToolResultIds(message);
  }

  for (let index = pendingTools.length - 1; index >= 0; index -= 1) {
    const pendingTool = pendingTools[index];
    if (pendingTool.result_msg_id) return pendingTool.result_msg_id;

    const resultMessageId = toolResultMessageIds.get(pendingTool.id);
    if (resultMessageId) return resultMessageId;
  }

  return fallbackParentMessageId;
}
