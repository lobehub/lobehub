import { parseJsonlRecords } from './utils';

/**
 * Turn the tail of a Claude Code local transcript
 * (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`) back into the
 * `--output-format stream-json` lines the CLI would have printed for that turn.
 *
 * Why: when the desktop app restarts (or its renderer reloads) mid-run, the
 * CLI process dies or keeps running headless, and everything it produced after
 * the last flushed chunk never reached LobeHub. The transcript on disk still
 * has it. Feeding these synthesized lines through the same
 * `AgentStreamPipeline` a live process uses persists that work exactly as if
 * the app had been watching — same adapter, same reducer, same rows.
 *
 * Shape notes (verified against real transcripts):
 * - `assistant` / `user` records already carry the Anthropic `message` the
 *   stream-json events wrap; the event shape differs only in envelope fields
 *   (`session_id` vs `sessionId`, `tool_use_result` vs `toolUseResult`).
 * - One transcript line per assistant content block, sharing `message.id` —
 *   exactly how stream-json emits them, so no merging is needed here.
 * - Parallel tool results live on sibling branches of the trunk; they are
 *   indexed globally by `tool_use_id` and emitted right after their
 *   `tool_use`, in tool order.
 * - Sidechain (subagent) records live in separate files and are not replayed.
 */

export interface ClaudeCodeReplayTurn {
  /**
   * True when the turn ended on its own: the last main-chain record is an
   * assistant message, every `tool_use` has a `tool_result`, and the model did
   * not stop to call another tool. False means the run was cut off and needs
   * a `--resume` continuation after the replay.
   */
  complete: boolean;
  /** stream-json lines, in emission order (system init first, result last when complete). */
  lines: string[];
  /** Text of the user prompt that opened the turn (for diagnostics / matching). */
  promptText: string;
  /** Transcript record uuid of that prompt. */
  promptUuid: string;
  /** Number of assistant / tool_result records replayed. */
  recordCount: number;
  sessionId: string;
}

const isConversational = (record: any): boolean =>
  !record?.isSidechain && (record?.type === 'user' || record?.type === 'assistant');

const textOfContent = (content: any): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: any) => (block?.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n\n');
};

/**
 * A user record that opens a turn: real input, not a `tool_result` carrier and
 * not one of the CLI's own meta injections (`isMeta`, e.g. the synthesized
 * "[Request interrupted by user for tool use]" follow-up on resume).
 */
const isUserPrompt = (record: any): boolean => {
  if (record?.type !== 'user' || record.isMeta) return false;
  const content = record.message?.content;
  if (typeof content === 'string') return content.length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((block: any) => block?.type !== 'tool_result');
};

const walkTrunk = (records: any[]): any[] => {
  const byUuid = new Map<string, any>();
  for (const record of records) if (record?.uuid) byUuid.set(record.uuid, record);

  const lastPrompt = records.findLast((r) => r?.type === 'last-prompt');
  const leafUuid: string | undefined =
    lastPrompt?.leafUuid ?? records.findLast((r) => r?.uuid && isConversational(r))?.uuid;
  if (!leafUuid) return [];

  const chain: any[] = [];
  const visited = new Set<string>();
  let cursor = byUuid.get(leafUuid);
  while (cursor && cursor.uuid && !visited.has(cursor.uuid)) {
    visited.add(cursor.uuid);
    chain.unshift(cursor);
    cursor = cursor.parentUuid ? byUuid.get(cursor.parentUuid) : undefined;
  }
  return chain;
};

const toAssistantLine = (record: any, sessionId: string): string =>
  JSON.stringify({
    message: record.message,
    parent_tool_use_id: null,
    session_id: sessionId,
    type: 'assistant',
    uuid: record.uuid,
  });

const toUserLine = (record: any, sessionId: string): string =>
  JSON.stringify({
    message: record.message,
    parent_tool_use_id: null,
    session_id: sessionId,
    // The live event spells this in snake_case; the transcript in camelCase.
    ...(record.toolUseResult === undefined ? {} : { tool_use_result: record.toolUseResult }),
    type: 'user',
    uuid: record.uuid,
  });

/**
 * Build the replay for the LAST turn of a transcript. Returns null when the
 * transcript has no session id or no user prompt to anchor on.
 */
export const buildClaudeCodeReplayTurn = (content: string): ClaudeCodeReplayTurn | null => {
  const records = parseJsonlRecords(content);
  if (records.length === 0) return null;

  const sessionId: string | undefined = records.find((r) => r?.sessionId)?.sessionId;
  if (!sessionId) return null;

  const trunk = walkTrunk(records).filter((r) => isConversational(r));
  const promptIndex = trunk.findLastIndex((r) => isUserPrompt(r));
  if (promptIndex < 0) return null;

  const prompt = trunk[promptIndex];
  const turn = trunk.slice(promptIndex + 1);

  // Every tool_result in the file, by the tool_use it answers. Parallel tool
  // calls park their results on sibling branches the trunk walk never visits.
  const toolResultByUseId = new Map<string, any>();
  for (const record of records) {
    if (record?.type !== 'user' || record.isSidechain) continue;
    const blocks = record.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block?.type === 'tool_result' && block.tool_use_id) {
        toolResultByUseId.set(block.tool_use_id, record);
      }
    }
  }

  const lines: string[] = [];
  const emitted = new Set<string>();
  let model: string | undefined;
  let lastAssistant: any;
  let lastUsage: any;
  let dangling = false;
  let recordCount = 0;

  const emitToolResult = (toolUseId: string) => {
    const record = toolResultByUseId.get(toolUseId);
    if (!record) {
      dangling = true;
      return;
    }
    if (emitted.has(record.uuid)) return;
    emitted.add(record.uuid);
    lines.push(toUserLine(record, sessionId));
    recordCount++;
  };

  for (const record of turn) {
    if (emitted.has(record.uuid)) continue;

    if (record.type === 'assistant') {
      emitted.add(record.uuid);
      model ??= record.message?.model;
      lastAssistant = record;
      if (record.message?.usage) lastUsage = record.message.usage;
      lines.push(toAssistantLine(record, sessionId));
      recordCount++;

      const blocks = Array.isArray(record.message?.content) ? record.message.content : [];
      for (const block of blocks) {
        if (block?.type === 'tool_use' && block.id) emitToolResult(block.id);
      }
      continue;
    }

    // A trunk user record here is a tool_result carrier the loop above did not
    // reach through its tool_use (or a meta injection) — emit tool results only.
    const blocks = record.message?.content;
    const hasToolResult =
      Array.isArray(blocks) && blocks.some((block: any) => block?.type === 'tool_result');
    if (!hasToolResult) continue;
    emitted.add(record.uuid);
    lines.push(toUserLine(record, sessionId));
    recordCount++;
  }

  const endedOnAssistant = turn.at(-1)?.type === 'assistant' && !!lastAssistant;
  const stoppedForTool = lastAssistant?.message?.stop_reason === 'tool_use';
  const complete =
    endedOnAssistant && !dangling && !stoppedForTool && !lastAssistant?.isApiErrorMessage;

  lines.unshift(
    JSON.stringify({
      cwd: records.find((r) => r?.cwd)?.cwd,
      mcp_servers: [],
      model,
      session_id: sessionId,
      subtype: 'init',
      tools: [],
      type: 'system',
    }),
  );

  if (complete) {
    lines.push(
      JSON.stringify({
        duration_ms: 0,
        is_error: false,
        result: textOfContent(lastAssistant?.message?.content),
        session_id: sessionId,
        subtype: 'success',
        type: 'result',
        ...(lastUsage ? { usage: lastUsage } : {}),
      }),
    );
  }
  // A cut-off turn gets NO `result` line, mirroring a CLI killed mid-turn: the
  // pipeline flush marks the dangling tool unsuccessful and the caller closes
  // the runtime as interrupted, so the replay never drains queued messages or
  // fires a "run finished" notification — the continuation owns the ending.

  return {
    complete,
    lines,
    promptText: textOfContent(prompt.message?.content),
    promptUuid: prompt.uuid,
    recordCount,
    sessionId,
  };
};
