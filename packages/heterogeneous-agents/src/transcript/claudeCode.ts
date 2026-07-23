import type {
  HeteroSessionDigest,
  HeteroSessionImportMessage,
  HeteroSessionImportPayload,
  HeteroSessionImportToolCall,
} from '@lobechat/types';

import {
  parseJsonlRecords,
  stripNulDeep,
  toModelUsageFromAnthropic,
  transcriptEndAt,
  truncateTitle,
} from './utils';

/**
 * Parser for Claude Code local session transcripts
 * (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`).
 *
 * Format notes (verified against real transcripts):
 * - one JSON record per line; `user` / `assistant` records carry
 *   `uuid` / `parentUuid` / `isSidechain` / `sessionId` / `cwd` / `gitBranch` / `timestamp`
 * - `assistant.message` is a full Anthropic API message; ONE LINE PER CONTENT BLOCK,
 *   consecutive lines share the same `message.id` and must be merged
 * - the current trunk is the `parentUuid` ancestor chain of `last-prompt.leafUuid`;
 *   the chain passes through meta records (`attachment`, ...) as well
 * - parallel tool_use results live on SIBLING branches of the trunk, so tool_results
 *   must be matched globally by `tool_use_id`, not collected from the chain
 * - `ai-title` / `last-prompt` appear once per turn — the last one wins
 * - Claude Code may REUSE an assistant `message.id` non-consecutively (post-tool
 *   text); uuid-based clientIds keep rows unique regardless
 * - subagent transcripts live in `<sessionId>/subagents/agent-*.jsonl` with
 *   `isSidechain: true` records; parse them with `{ sidechain: true }`
 */

export const CLAUDE_CODE_IDENTIFIER = 'claude-code';

export interface ParseClaudeCodeOptions {
  /**
   * Override the sessionId stamped into `metadata.heteroSessionId` (defaults
   * to the transcript's own). Subagent transcripts carry the parent session.
   */
  sessionIdOverride?: string;
  /**
   * Parse sidechain (subagent) records instead of main-chain records.
   * Used for `subagents/agent-*.jsonl` transcripts.
   */
  sidechain?: boolean;
}

interface ImageStats {
  bytes: number;
  count: number;
}

const textOfContent = (content: any, img?: ImageStats): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: any) => {
      if (block?.type === 'text') return block.text;
      if (block?.type === 'image') {
        if (img) {
          img.count++;
          img.bytes += block.source?.data?.length ?? 0;
        }
        return '![imported image placeholder]';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
};

/**
 * Claude Code prepends an injected `## Workspace` preamble to the first user
 * message; strip it when the message doubles as the title / prompt preview.
 */
const CC_PREAMBLE_RE = /^##\s*workspace\b[\S\s]+?working directory is[^\n]*?\.\s*/i;
const stripCcPreamble = (text: string): string => {
  if (!/^##\s*workspace\b/i.test(text)) return text;
  const stripped = text.replace(CC_PREAMBLE_RE, '').trim();
  return stripped || text;
};

/** total input+output tokens, counted once per assistant message.id */
const sumCcTokens = (records: any[]): number => {
  let total = 0;
  const seen = new Set<string>();
  for (const r of records) {
    if (r.type !== 'assistant' || r.isSidechain) continue;
    const id = r.message?.id ?? r.uuid;
    const usage = r.message?.usage;
    if (!usage || seen.has(id)) continue;
    seen.add(id);
    total += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  }
  return total;
};

/** main-chain conversational records — the ones the endAt fingerprint is taken from */
const isMainConversational = (r: any) =>
  !r.isSidechain && (r.type === 'user' || r.type === 'assistant');

export interface ParsedClaudeCodeSession {
  /** total base64 chars of embedded images replaced by placeholders */
  imageBytes: number;
  imageCount: number;
  messages: HeteroSessionImportMessage[];
  sessionId: string;
  /** last raw record timestamp — compared with a fresh digest's `endAt` */
  sourceEndAt?: string;
  title?: string;
  workingDirectory?: string;
}

/**
 * Parse a Claude Code transcript into normalized import messages.
 * Returns null when the transcript contains no importable conversation.
 */
export const parseClaudeCodeSession = (
  content: string,
  options?: ParseClaudeCodeOptions,
): ParsedClaudeCodeSession | null => {
  const sidechain = options?.sidechain ?? false;
  const records = parseJsonlRecords(content);
  if (records.length === 0) return null;

  const matchesSide = (r: any) => Boolean(r.isSidechain) === sidechain;
  const byUuid = new Map<string, any>();
  for (const r of records) if (r.uuid) byUuid.set(r.uuid, r);

  const aiTitle: string | undefined = records.findLast((r) => r.type === 'ai-title')?.aiTitle;
  const lastPrompt = records.findLast((r) => r.type === 'last-prompt');
  const firstUserRec = records.find((r) => r.type === 'user' && matchesSide(r));
  const transcriptSessionId: string | undefined = records.find((r) => r.sessionId)?.sessionId;
  const sessionId = options?.sessionIdOverride ?? transcriptSessionId;
  if (!sessionId) return null;
  const workingDirectory: string | undefined = records.find((r) => r.cwd)?.cwd;

  const leafUuid: string | undefined =
    lastPrompt?.leafUuid ??
    records.findLast(
      (r) => r.uuid && matchesSide(r) && (r.type === 'user' || r.type === 'assistant'),
    )?.uuid;
  if (!leafUuid) return null;

  // walk the trunk leaf -> root; the chain passes through meta records too
  const chain: any[] = [];
  let cursor = byUuid.get(leafUuid);
  const visited = new Set<string>();
  while (cursor && cursor.uuid && !visited.has(cursor.uuid)) {
    visited.add(cursor.uuid);
    chain.unshift(cursor);
    cursor = cursor.parentUuid ? byUuid.get(cursor.parentUuid) : undefined;
  }

  // index ALL tool_results by tool_use_id — parallel tool_use results are
  // sibling branches of the trunk and would be lost by a pure ancestor walk
  const toolResultByUseId = new Map<string, { block: any; record: any }>();
  for (const r of records) {
    if (r.type !== 'user' || !matchesSide(r) || !Array.isArray(r.message?.content)) continue;
    for (const block of r.message.content) {
      if (block?.type === 'tool_result' && block.tool_use_id)
        toolResultByUseId.set(block.tool_use_id, { block, record: r });
    }
  }

  const img: ImageStats = { bytes: 0, count: 0 };
  const messages: HeteroSessionImportMessage[] = [];
  let prevClientId: string | null = null;
  // record uuids are globally unique across session files (CC forks generate
  // fresh uuids, never copies), so clientIds don't need session scoping —
  // unlike codex, whose stream indexes (`i<n>`) repeat in every rollout
  const clientIdOf = (key: string) => `claude-code-${key}`;

  const chainMain = chain.filter(
    (r) => matchesSide(r) && (r.type === 'user' || r.type === 'assistant'),
  );

  let i = 0;
  while (i < chainMain.length) {
    const rec = chainMain[i];

    if (rec.type === 'user') {
      const content_ = rec.message?.content;
      const isToolResultOnly =
        Array.isArray(content_) && content_.every((b: any) => b?.type === 'tool_result');
      // tool_result-only records are emitted via the assistant's tool_use blocks
      if (!isToolResultOnly) {
        const clientId = clientIdOf(rec.uuid);
        messages.push({
          clientId,
          content: textOfContent(content_, img),
          createdAt: rec.timestamp,
          metadata: { heteroMessageId: rec.uuid, heteroSessionId: sessionId },
          parentClientId: prevClientId,
          role: 'user',
        });
        prevClientId = clientId;
      }
      i++;
      continue;
    }

    // assistant: merge consecutive records sharing message.id (one line per block)
    const msgId: string = rec.message?.id ?? rec.uuid;
    const group: any[] = [];
    while (i < chainMain.length && chainMain[i].type === 'assistant') {
      if ((chainMain[i].message?.id ?? chainMain[i].uuid) !== msgId) break;
      group.push(chainMain[i]);
      i++;
    }

    const reasoningParts: string[] = [];
    const textParts: string[] = [];
    const tools: HeteroSessionImportToolCall[] = [];
    for (const g of group)
      for (const block of g.message?.content ?? []) {
        // signature-only thinking blocks (interleaved thinking) carry an empty
        // `thinking` string — skip them so no `{content: ''}` reasoning is written
        if (block?.type === 'thinking' && block.thinking?.trim())
          reasoningParts.push(block.thinking);
        else if (block?.type === 'text') textParts.push(block.text);
        else if (block?.type === 'tool_use')
          tools.push({
            apiName: block.name,
            arguments: JSON.stringify(block.input ?? {}),
            id: block.id,
            identifier: CLAUDE_CODE_IDENTIFIER,
            type: 'default',
          });
      }

    const rawUsage = group.at(-1)?.message?.usage;
    const usage = toModelUsageFromAnthropic(rawUsage);
    // message.id may be reused non-consecutively — uuid keeps the clientId unique
    const assistantClientId = clientIdOf(group[0].uuid);
    messages.push({
      clientId: assistantClientId,
      content: textParts.join('\n\n'),
      createdAt: group[0].timestamp,
      metadata: {
        // the record's own id in the CC session file (`uuid`), NOT the
        // Anthropic API `message.id` (which is reused across records)
        heteroMessageId: group[0].uuid,
        heteroSessionId: sessionId,
        // non-token usage extras belong to metadata, not the usage column
        ...(rawUsage?.service_tier ? { serviceTier: rawUsage.service_tier } : {}),
        ...(rawUsage?.speed ? { speed: rawUsage.speed } : {}),
      },
      model: group[0].message?.model,
      parentClientId: prevClientId,
      provider: CLAUDE_CODE_IDENTIFIER,
      role: 'assistant',
      ...(reasoningParts.length > 0 ? { reasoning: { content: reasoningParts.join('\n\n') } } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...(usage ? { usage } : {}),
    });
    prevClientId = assistantClientId;

    for (const tool of tools) {
      const match = toolResultByUseId.get(tool.id);
      if (!match) continue;
      const toolClientId = clientIdOf(`${match.record.uuid}#${tool.id}`);
      messages.push({
        clientId: toolClientId,
        content: textOfContent(match.block.content, img),
        createdAt: match.record.timestamp,
        metadata: { heteroMessageId: match.record.uuid, heteroSessionId: sessionId },
        parentClientId: assistantClientId,
        plugin: {
          apiName: tool.apiName,
          arguments: tool.arguments,
          identifier: CLAUDE_CODE_IDENTIFIER,
          type: 'default',
        },
        role: 'tool',
        toolCallId: tool.id,
      });
      prevClientId = toolClientId;
    }
  }

  if (messages.length === 0) return null;

  return {
    imageBytes: img.bytes,
    imageCount: img.count,
    messages: stripNulDeep(messages),
    sessionId,
    // sidechain transcripts are their own file; take the fingerprint from the
    // side actually being parsed so a subagent thread doesn't inherit the main chain's
    sourceEndAt: transcriptEndAt(
      records,
      (r) => matchesSide(r) && (r.type === 'user' || r.type === 'assistant'),
    ),
    title: aiTitle ?? truncateTitle(stripCcPreamble(textOfContent(firstUserRec?.message?.content))),
    workingDirectory,
  };
};

/**
 * Build the full normalized import payload for a Claude Code session.
 */
export const buildClaudeCodeImportPayload = (
  content: string,
  options?: ParseClaudeCodeOptions,
): HeteroSessionImportPayload | null => {
  const parsed = parseClaudeCodeSession(content, options);
  if (!parsed) return null;

  return {
    messages: parsed.messages,
    metadata: {
      heteroSessionId: parsed.sessionId,
      ...(parsed.workingDirectory
        ? { heteroSessionIdByWorkingDirectory: { [parsed.workingDirectory]: parsed.sessionId } }
        : {}),
      importedFrom: 'claude-code-local',
    },
    sessionId: parsed.sessionId,
    source: 'claude-code',
    sourceEndAt: parsed.sourceEndAt,
    title: parsed.title,
    topicClientId: `claude-code-session-${parsed.sessionId}`,
    workingDirectory: parsed.workingDirectory,
  };
};

/**
 * Lightweight digest for the import-picker list. Reads meta rows and counts
 * without building the full message payload.
 */
export const parseClaudeCodeSessionDigest = (
  content: string,
  filePath: string,
): HeteroSessionDigest | null => {
  const records = parseJsonlRecords(content);
  if (records.length === 0) return null;

  const sessionId: string | undefined = records.find((r) => r.sessionId)?.sessionId;
  if (!sessionId) return null;

  const main = records.filter((r) => isMainConversational(r));
  if (main.length === 0) return null;

  const aiTitle: string | undefined = records.findLast((r) => r.type === 'ai-title')?.aiTitle;
  const firstUserRec = records.find((r) => r.type === 'user' && !r.isSidechain);
  const firstPrompt = truncateTitle(
    stripCcPreamble(textOfContent(firstUserRec?.message?.content)),
    200,
  );

  return {
    endAt: transcriptEndAt(records, isMainConversational),
    filePath,
    firstPrompt,
    gitBranch: records.find((r) => r.gitBranch)?.gitBranch,
    messageCount: main.length,
    sessionId,
    source: 'claude-code',
    startAt: main[0]?.timestamp,
    title: aiTitle ?? truncateTitle(firstPrompt),
    tokens: sumCcTokens(records),
    workingDirectory: records.find((r) => r.cwd)?.cwd,
  };
};
