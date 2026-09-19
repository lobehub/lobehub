import type { HeteroSessionImportMessage, UIChatMessage } from '@lobechat/types';
import pMap from 'p-map';

/** Bounded so rebuilding a long topic's transcript can't stampede the API. */
const HYDRATE_CONCURRENCY = 6;

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
 * Restore the stored body of any tool message the read path projected away,
 * for the ONE consumer that feeds it back to a model.
 *
 * Everything else the store drives is a render, which the view model already
 * satisfies. A resume replay is different: it rebuilds a transcript that the
 * external CLI then resumes from, so an emptied tool result would be written to
 * disk and every later turn would read it back as a tool that returned nothing.
 *
 * Only runs when a GC'd session forces a rebuild, so the fetch cost lands on a
 * path that is already doing far more expensive work.
 */
export const hydrateProjectedToolMessages = async (
  messages: UIChatMessage[] | undefined,
  fetchStoredPayload: (messageId: string) => Promise<{ content: string } | undefined | null>,
): Promise<UIChatMessage[] | undefined> => {
  if (!messages?.length) return messages;

  const projected = messages.filter((m) => m.role === 'tool' && !!m.payloadOmitted);
  if (projected.length === 0) return messages;

  const restored = new Map<string, string>();
  await pMap(
    projected,
    async (m) => {
      try {
        const payload = await fetchStoredPayload(m.id);
        if (typeof payload?.content === 'string') restored.set(m.id, payload.content);
      } catch (error) {
        // Replay the trimmed body rather than failing the turn: a degraded
        // transcript still resumes, a thrown error loses the user's prompt.
        console.error('[resumeReplay] failed to restore tool payload %s: %O', m.id, error);
      }
    },
    { concurrency: HYDRATE_CONCURRENCY },
  );

  if (restored.size === 0) return messages;

  return messages.map((m) => (restored.has(m.id) ? { ...m, content: restored.get(m.id)! } : m));
};

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
