import { LOADING_FLAT } from '@lobechat/const';
import type { HeteroSessionImportMessage, UIChatMessage } from '@lobechat/types';

/**
 * Is a restored transcript worth paying for on this adapter?
 *
 * Main consumes `resumeReplayMessages` in exactly one place —
 * `HeterogeneousAgentImpl`'s `ensureClaudeCodeResumeTranscript` — which is
 * gated on `agentType === 'claude-code'`. Every other adapter is handed the
 * replay and ignores it, so restoring bodies for them would spend one
 * authenticated round trip per historical tool, on every turn, for nothing.
 *
 * Keep this in step with that call site if another adapter starts rebuilding a
 * transcript.
 */
export const shouldHydrateResumeReplay = (providerType?: string): boolean =>
  providerType === 'claude-code';

/**
 * Map the topic's chat messages into the normalized shape
 * `buildClaudeCodeTranscript` consumes, so a GC'd Claude Code session can be
 * rebuilt on disk before `--resume`.
 *
 * Only real conversation roles survive — virtual/grouping roles
 * (`assistantGroup`, `tasks`, `compressedGroup`, `system`, …) carry no
 * replayable turn and would corrupt the rebuilt chain.
 *
 * `promptInFlight` is the prompt about to be sent this turn; it (and any empty
 * placeholder trailing it) is dropped so the rebuilt history holds only
 * PREVIOUS turns — the new prompt is delivered separately by the spawn.
 */
export const buildResumeReplayMessages = (
  messages: UIChatMessage[] | undefined,
  promptInFlight?: string,
): HeteroSessionImportMessage[] => {
  if (!messages || messages.length === 0) return [];

  const mapped: HeteroSessionImportMessage[] = [];

  for (const m of messages) {
    const createdAt = m.createdAt ? new Date(m.createdAt).toISOString() : undefined;
    const base = { clientId: m.id, content: m.content ?? '', ...(createdAt ? { createdAt } : {}) };

    if (m.role === 'user') {
      mapped.push({ ...base, role: 'user' });
      continue;
    }

    if (m.role === 'assistant') {
      const tools = (m.tools ?? []).map((t) => ({
        apiName: t.apiName,
        arguments: t.arguments,
        id: t.id,
        identifier: t.identifier,
        // the transcript only replays the call itself; the render type is a UI
        // concern and the import shape pins it to 'default' (same as the parser)
        type: 'default' as const,
      }));
      mapped.push({ ...base, role: 'assistant', ...(tools.length > 0 ? { tools } : {}) });
      continue;
    }

    if (m.role === 'tool' && m.tool_call_id) {
      mapped.push({ ...base, role: 'tool', toolCallId: m.tool_call_id });
    }
  }

  // Drop trailing in-flight turns: the empty assistant placeholder created for
  // this run, and the user message carrying the prompt we're about to send.
  while (mapped.length > 0) {
    const last = mapped.at(-1)!;
    const isEmptyAssistant =
      last.role === 'assistant' && !last.content.trim() && (last.tools?.length ?? 0) === 0;
    const isPromptEcho =
      last.role === 'user' && !!promptInFlight && last.content.trim() === promptInFlight.trim();
    if (!isEmptyAssistant && !isPromptEcho) break;
    mapped.pop();
  }

  return mapped;
};

/** Same limits as the gateway's `<previous_conversation>` fallback. */
const EDITED_TOPIC_MAX_TURNS = 30;
const EDITED_TOPIC_USER_MAX = 1024;
const EDITED_TOPIC_ASSISTANT_MAX = 2048;

/**
 * Serialize the copied ancestry of an edited topic for a fresh local run.
 *
 * Use when:
 * - A topic created by Codex edit-and-resend (`metadata.editedFrom`) starts
 *   without a native session, so the CLI would otherwise see no history.
 *
 * Expects:
 * - The topic's persisted rows and the assistant placeholder of this run,
 *   whose parent is the edited user message.
 *
 * Returns:
 * - A `<previous_conversation>` block of the completed user/assistant turns
 *   before the edited message (the prompt itself is sent separately), or
 *   `undefined` when there is nothing to replay. Tool rows are walked through
 *   but not serialized, matching the gateway fallback.
 */
export const buildEditedTopicPreviousConversation = (
  messages: UIChatMessage[] | undefined,
  assistantMessageId: string,
): string | undefined => {
  if (!messages?.length) return;
  const byId = new Map(messages.map((message) => [message.id, message]));
  const prompt = byId.get(byId.get(assistantMessageId)?.parentId ?? '');
  if (prompt?.role !== 'user') return;

  const turns: string[] = [];
  const visited = new Set<string>([prompt.id]);
  let id = prompt.parentId;
  while (id && !visited.has(id) && turns.length < EDITED_TOPIC_MAX_TURNS) {
    visited.add(id);
    const message = byId.get(id);
    if (!message) break;
    id = message.parentId;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = message.content?.trim();
    if (!content || content === LOADING_FLAT) continue;
    const limit = message.role === 'user' ? EDITED_TOPIC_USER_MAX : EDITED_TOPIC_ASSISTANT_MAX;
    const body = content.length > limit ? `${content.slice(0, limit)}… [truncated]` : content;
    turns.push(`<${message.role}>\n${body}\n</${message.role}>`);
  }
  if (turns.length === 0) return;

  return `<previous_conversation>\n${turns.reverse().join('\n')}\n</previous_conversation>`;
};
