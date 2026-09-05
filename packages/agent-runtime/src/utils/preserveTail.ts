import { countContextTokens } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';

/**
 * Fraction of the compression threshold the preserved tail may occupy.
 *
 * Small enough that compression still frees the bulk of the window, large
 * enough that the model keeps the step it was in the middle of — the tool
 * results and edits it just produced, which a prose summary reliably loses.
 */
export const DEFAULT_TAIL_PRESERVE_RATIO = 0.2;

/**
 * Absolute cap on the preserved tail. Without it a 1M-token window would carry
 * ~180k of raw history past every compaction, which defeats the point.
 */
export const MAX_TAIL_PRESERVE_TOKENS = 32_000;

/**
 * Token budget for the preserved tail, derived from the compression threshold.
 */
export const getTailPreserveBudget = (
  threshold: number,
  ratio: number = DEFAULT_TAIL_PRESERVE_RATIO,
): number => Math.min(Math.floor(threshold * ratio), MAX_TAIL_PRESERVE_TOKENS);

/**
 * The message that triggered this turn must never be summarized away, even
 * when it alone blows the budget.
 */
const lastUserMessageOnly = (messages: UIChatMessage[]): UIChatMessage[] => {
  const last = messages.at(-1);
  return last?.role === 'user' ? [last] : [];
};

/**
 * Pick the longest suffix of `messages` that fits in `maxTokens`.
 *
 * Compression replaces history with a summary; whatever this returns is kept
 * verbatim alongside it. Preserving the tail is what lets the model continue
 * the step it was in rather than restarting from a paraphrase — without it,
 * an agent that compresses mid-loop loses every tool result it just gathered
 * and goes back to re-reading the same files.
 *
 * Two invariants:
 * - at least one message is always left to compress, so the pass is never a
 *   no-op that re-triggers on the next step;
 * - the segment never *starts* on a `tool` message, whose originating
 *   assistant `tool_calls` would have been summarized away — most providers
 *   reject that orphaned pairing.
 */
export function selectPreservedTail(messages: UIChatMessage[], maxTokens: number): UIChatMessage[] {
  if (messages.length <= 1) return [];
  if (maxTokens <= 0) return lastUserMessageOnly(messages);

  const { messages: breakdown } = countContextTokens({ messages });

  // Walk backwards while the suffix still fits. `i >= 1` keeps index 0 out of
  // the tail so there is always something left to summarize.
  let start = messages.length;
  let used = 0;
  for (let i = messages.length - 1; i >= 1; i--) {
    const cost = breakdown[i]?.total ?? 0;
    if (used + cost > maxTokens) break;
    used += cost;
    start = i;
  }

  // Drop orphaned tool results at the head of the segment.
  while (start < messages.length && messages[start]?.role === 'tool') start++;

  const tail = messages.slice(start);

  return tail.length > 0 ? tail : lastUserMessageOnly(messages);
}

/**
 * Container roles whose real conversation rows are folded into a child array.
 * `assistantGroup` / `supervisor` use `children`, `agentCouncil` uses `members`,
 * `tasks` / `groupTasks` use `tasks`. `compare` nests one level deeper.
 */
const CONTAINER_CHILD_KEYS = ['children', 'members', 'tasks', 'council'] as const;

const collectRowIds = (node: unknown, into: Set<string>): void => {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;

  if (typeof record.id === 'string' && record.id) into.add(record.id);

  // A folded tool entry carries the id of its own persisted `tool` row.
  if (Array.isArray(record.tools)) {
    for (const tool of record.tools) {
      const resultId = (tool as { result_msg_id?: unknown })?.result_msg_id;
      if (typeof resultId === 'string' && resultId) into.add(resultId);
    }
  }

  for (const key of CONTAINER_CHILD_KEYS) {
    const children = record[key];
    if (Array.isArray(children)) for (const child of children) collectRowIds(child, into);
  }

  // `compare` holds Message[][]
  if (Array.isArray(record.columns)) {
    for (const column of record.columns) {
      if (Array.isArray(column)) for (const entry of column) collectRowIds(entry, into);
    }
  }
};

/**
 * Every persisted row id the preserved messages stand for.
 *
 * On the server path `state.messages` is a conversation-flow projection, so a
 * whole tool chain arrives as one virtual `assistantGroup` whose `id` is just
 * its *first* assistant — the child assistants and tool rows live in
 * `children[]`. The compression executor filters raw DB rows, so taking only
 * top-level `message.id` would leave every folded child unprotected and fold
 * the exact tool round the tail preservation is meant to keep. Synthetic
 * wrapper ids (`tasks`, `agentCouncil`, `council-*`) match no row and are
 * harmless to include.
 */
export function collectPreservedMessageIds(messages: UIChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) collectRowIds(message, ids);
  return ids;
}
