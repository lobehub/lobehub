import type { HeteroSessionImportMessage } from '@lobechat/types';

/**
 * Rebuild a Claude Code transcript JSONL from normalized messages — the inverse
 * of {@link parseClaudeCodeSession} (transcript → messages).
 *
 * Why this exists: the Claude Code CLI garbage-collects local transcripts
 * (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`) after `cleanupPeriodDays`
 * (default 30). Once the file is gone, `--resume <sessionId>` fails with
 * "No conversation found with session ID". Rebuilding the transcript from the
 * messages LobeHub still holds lets `--resume` hydrate the full native history
 * (text + tool cycles) again, and CC appends new turns in place under the same
 * sessionId — so the stored `heteroSessionId` stays valid.
 *
 * Fidelity rules (verified against the bundled CLI + a live `--resume` round-trip):
 * - Emit only replay-safe content: user text, assistant text + `tool_use`,
 *   and `tool_result` (as a `type:"user"` record).
 * - DROP `thinking` blocks: their `signature` can't be reconstructed from the
 *   DB, and the Anthropic API rejects thinking blocks with invalid signatures
 *   when the history is replayed. Text + tool cycles rebuild a faithful,
 *   replayable conversation without them.
 * - Every `tool_use` must be answered by a `tool_result`, and the transcript
 *   must NOT end on an unanswered `tool_use`, or the next-turn API call 400s.
 *   Trailing unanswered tool calls are trimmed.
 */

export interface BuildClaudeCodeTranscriptOptions {
  /** cwd stamped into every record (the un-encoded real path). */
  cwd: string;
  /** git branch stamped into every record (optional, cosmetic). */
  gitBranch?: string;
  /** model stamped onto assistant records (cosmetic; defaults to a placeholder). */
  model?: string;
  /** the sessionId — MUST equal the transcript filename stem. */
  sessionId: string;
  /** CLI version string stamped into every record (cosmetic). */
  version?: string;
}

const DEFAULT_VERSION = '2.1.215';
const DEFAULT_MODEL = 'claude-opus-4-8';

const uuid = (): string => globalThis.crypto.randomUUID();

const safeParse = (s: string): any => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

/**
 * A single reconstructed transcript record plus the tool-call ids it introduces
 * (assistant) or answers (tool), so we can trim trailing unanswered tool calls.
 */
interface StagedRecord {
  /** tool_use ids this assistant record opens (empty otherwise). */
  opensToolIds: string[];
  record: Record<string, any>;
  /** tool_use id this record answers (tool records only). */
  resolvesToolId?: string;
  role: 'assistant' | 'tool' | 'user';
}

/**
 * Build the transcript JSONL text (newline-joined, trailing newline) for the
 * given messages. Returns an empty string when there's nothing replay-worthy.
 */
export const buildClaudeCodeTranscript = (
  messages: HeteroSessionImportMessage[],
  options: BuildClaudeCodeTranscriptOptions,
): string => {
  const { cwd, sessionId } = options;
  const gitBranch = options.gitBranch ?? '';
  const version = options.version ?? DEFAULT_VERSION;
  const model = options.model ?? DEFAULT_MODEL;

  const envelope = (extra: Record<string, any>): Record<string, any> => ({
    isSidechain: false,
    userType: 'external',
    entrypoint: 'sdk-cli',
    cwd,
    sessionId,
    version,
    gitBranch,
    ...extra,
  });

  const staged: StagedRecord[] = [];

  for (const m of messages) {
    const timestamp = m.createdAt ?? new Date().toISOString();

    if (m.role === 'user') {
      staged.push({
        opensToolIds: [],
        role: 'user',
        record: envelope({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: m.content ?? '' }] },
          timestamp,
        }),
      });
      continue;
    }

    if (m.role === 'assistant') {
      const content: any[] = [];
      if (m.content && m.content.trim()) content.push({ type: 'text', text: m.content });
      const opensToolIds: string[] = [];
      for (const t of m.tools ?? []) {
        content.push({
          type: 'tool_use',
          id: t.id,
          name: t.apiName,
          input: safeParse(t.arguments),
          caller: { type: 'direct' },
        });
        opensToolIds.push(t.id);
      }
      // never emit an empty assistant turn — it carries no history and can
      // confuse the deserializer; skip it entirely
      if (content.length === 0) continue;
      staged.push({
        opensToolIds,
        role: 'assistant',
        record: envelope({
          type: 'assistant',
          requestId: `req_rebuilt_${staged.length}`,
          message: {
            model: m.model ?? model,
            id: `msg_rebuilt_${staged.length}`,
            type: 'message',
            role: 'assistant',
            content,
            stop_reason: opensToolIds.length > 0 ? 'tool_use' : 'end_turn',
            stop_sequence: null,
          },
          timestamp,
        }),
      });
      continue;
    }

    // role: 'tool' — a tool_result carried on a user record
    if (!m.toolCallId) continue;
    staged.push({
      opensToolIds: [],
      resolvesToolId: m.toolCallId,
      role: 'tool',
      record: envelope({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content ?? '' }],
        },
        timestamp,
        toolUseResult: { rebuilt: true },
      }),
    });
  }

  // Trim trailing records until every opened tool_use is answered by a later
  // tool_result. An unanswered trailing tool_use makes the next API turn 400.
  const answered = new Set<string>();
  for (const s of staged) if (s.resolvesToolId) answered.add(s.resolvesToolId);
  while (staged.length > 0) {
    const last = staged.at(-1)!;
    const unanswered = last.opensToolIds.some((id) => !answered.has(id));
    if (!unanswered) break;
    staged.pop();
    if (last.resolvesToolId) answered.delete(last.resolvesToolId);
  }

  if (staged.length === 0) return '';

  // Stamp the parentUuid chain + uuids now that trimming is settled.
  let parentUuid: string | null = null;
  const lines: string[] = [];
  for (const s of staged) {
    const recUuid = uuid();
    const rec: Record<string, any> = { ...s.record, uuid: recUuid, parentUuid };
    if (s.role === 'tool') rec.sourceToolAssistantUUID = parentUuid;
    lines.push(JSON.stringify(rec));
    parentUuid = recUuid;
  }

  return lines.join('\n') + '\n';
};

const MAX_DIR_SLUG = 200;

/**
 * Encode an already-resolved (realpath'd) cwd into the `~/.claude/projects/`
 * directory name, mirroring the CLI's own encoding:
 * `realpath(cwd).replace(/[^a-zA-Z0-9]/g,'-')`, NFC-normalized, with a base-36
 * hash suffix when the slug exceeds the CLI's max length.
 *
 * Pass an ALREADY realpath-resolved path — resolving symlinks needs fs and is
 * the caller's job (see `ensureClaudeCodeResumeTranscript`).
 */
export const encodeClaudeProjectDir = (realCwd: string): string => {
  const normalized = realCwd.normalize('NFC');
  const slug = normalized.replaceAll(/[^a-z0-9]/gi, '-');
  if (slug.length <= MAX_DIR_SLUG) return slug;
  // djb2-ish hash matching the CLI's "truncate + base36 hash" shape; the exact
  // hash doesn't need to match the CLI because callers only hit this branch for
  // pathologically long cwds, which LobeHub doesn't produce.
  let h = 0;
  for (let i = 0; i < normalized.length; i += 1)
    h = (Math.imul(31, h) + normalized.charCodeAt(i)) | 0;
  return `${slug.slice(0, MAX_DIR_SLUG)}-${Math.abs(h).toString(36)}`;
};
