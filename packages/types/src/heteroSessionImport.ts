import { z } from 'zod';

/**
 * Normalized payload for importing an external CLI agent session
 * (Claude Code / Codex local transcript) into LobeHub.
 *
 * Produced by the transcript parsers in `@lobechat/heterogeneous-agents/transcript`,
 * consumed by `HeteroSessionImporterRepo` in `@lobechat/database`.
 *
 * All entities carry a deterministic `clientId` derived from the source transcript,
 * so re-importing the same session is idempotent (existing rows are skipped) and
 * a grown transcript imports incrementally.
 */

export type HeteroSessionImportSource = 'claude-code' | 'codex';

export interface HeteroSessionImportToolCall {
  /** tool name, e.g. `Bash` / `exec_command` */
  apiName: string;
  /** JSON string of the tool arguments */
  arguments: string;
  /** tool_use id / call_id from the source transcript */
  id: string;
  /** builtin tool identifier, e.g. `claude-code` / `codex` */
  identifier: string;
  type: 'default';
}

export interface HeteroSessionImportMessage {
  /** deterministic id derived from the source transcript, unique within the user scope */
  clientId: string;
  content: string;
  /** ISO timestamp from the source transcript */
  createdAt?: string;
  metadata?: Record<string, any>;
  model?: string;
  /** clientId of the parent message (conversation chain) */
  parentClientId?: string | null;
  /** tool message plugin payload (role: 'tool' only) */
  plugin?: {
    apiName: string;
    arguments: string;
    identifier: string;
    type: string;
  };
  pluginState?: Record<string, any>;
  provider?: string;
  reasoning?: { content: string } & Record<string, any>;
  role: 'user' | 'assistant' | 'tool';
  /** tool_use id this tool message answers (role: 'tool' only) */
  toolCallId?: string;
  /** tool calls issued by this assistant message */
  tools?: HeteroSessionImportToolCall[];
  usage?: Record<string, any>;
}

export interface HeteroSessionImportThread {
  /** deterministic id derived from the source transcript */
  clientId: string;
  messages: HeteroSessionImportMessage[];
  /** clientId of the main-chain message this thread hangs on (e.g. the Task tool message) */
  sourceMessageClientId?: string;
  status?: 'active' | 'completed' | 'failed';
  title?: string;
  type: 'continuation' | 'standalone' | 'isolation';
}

export interface HeteroSessionImportPayload {
  /** main conversation chain */
  messages: HeteroSessionImportMessage[];
  /** extra metadata merged into the topic metadata */
  metadata?: Record<string, any>;
  /** native session id from the source CLI (Claude Code sessionId / Codex rollout id) */
  sessionId: string;
  source: HeteroSessionImportSource;
  /** subagent / sidechain transcripts, imported as threads */
  threads?: HeteroSessionImportThread[];
  title?: string;
  /** deterministic topic clientId, e.g. `claude-code-session-<sessionId>` */
  topicClientId: string;
  /** cwd the session was recorded under (used for resume binding) */
  workingDirectory?: string;
}

export interface HeteroSessionImportResult {
  /** whether a new topic was created (false = incremental into an existing one) */
  created: boolean;
  insertedMessages: number;
  insertedThreads: number;
  sessionId: string;
  skippedMessages: number;
  topicId: string;
}

/** import status of scanned sessions, for the picker UI badges */
export interface HeteroSessionImportStatus {
  imported: {
    messageCount: number;
    /** last source-transcript timestamp at import time — digest.endAt > this ⇒ syncable */
    sourceEndAt?: string;
    topicClientId: string;
    topicId: string;
  }[];
  /** sessionIds that originated from LobeHub live runs (importing would duplicate) */
  linked: string[];
}

/** Lightweight digest of a local session, for the import-picker list UI */
export interface HeteroSessionDigest {
  endAt?: string;
  filePath: string;
  firstPrompt?: string;
  gitBranch?: string;
  messageCount: number;
  sessionId: string;
  source: HeteroSessionImportSource;
  startAt?: string;
  title?: string;
  /** cumulative tokens (fresh input + output) across the session */
  tokens?: number;
  workingDirectory?: string;
}

// ===== desktop scan surface (HeteroSessionCtr IPC) =====

/**
 * Per-directory user preference, persisted in the desktop main-process store.
 * `none` is only ever STORED (never returned in scan results): it records that
 * the user explicitly restored a directory that would otherwise be ignored by
 * default (e.g. temp dirs), so the default doesn't re-apply on the next scan.
 */
export type HeteroSessionDirPref = 'ignored' | 'none' | 'watched';

/** sessions of one working directory, aggregated across storage folders */
export interface HeteroSessionDirGroup {
  dirPref?: HeteroSessionDirPref;
  /** any session in the dir carries a git branch */
  isGit: boolean;
  sessionCount: number;
  /** digests sorted by endAt desc */
  sessions: HeteroSessionDigest[];
  source: HeteroSessionImportSource;
  totalTokens: number;
  workingDirectory: string;
}

export interface HeteroSessionScanResult {
  /** per-file parse failures, for diagnostics — scan never throws on bad files */
  errors: string[];
  groups: HeteroSessionDirGroup[];
}

// ===== zod schemas (tRPC input validation), mirroring the interfaces above =====

export const heteroSessionImportToolCallSchema = z.object({
  apiName: z.string(),
  arguments: z.string(),
  id: z.string(),
  identifier: z.string(),
  type: z.literal('default'),
});

export const heteroSessionImportMessageSchema = z.object({
  clientId: z.string(),
  content: z.string(),
  createdAt: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  model: z.string().optional(),
  parentClientId: z.string().nullish(),
  plugin: z
    .object({
      apiName: z.string(),
      arguments: z.string(),
      identifier: z.string(),
      type: z.string(),
    })
    .optional(),
  pluginState: z.record(z.string(), z.any()).optional(),
  provider: z.string().optional(),
  reasoning: z.object({ content: z.string() }).passthrough().optional(),
  role: z.enum(['user', 'assistant', 'tool']),
  toolCallId: z.string().optional(),
  tools: z.array(heteroSessionImportToolCallSchema).optional(),
  usage: z.record(z.string(), z.any()).optional(),
});

export const heteroSessionImportThreadSchema = z.object({
  clientId: z.string(),
  messages: z.array(heteroSessionImportMessageSchema),
  sourceMessageClientId: z.string().optional(),
  status: z.enum(['active', 'completed', 'failed']).optional(),
  title: z.string().optional(),
  type: z.enum(['continuation', 'standalone', 'isolation']),
});

export const heteroSessionImportPayloadSchema = z.object({
  messages: z.array(heteroSessionImportMessageSchema),
  metadata: z.record(z.string(), z.any()).optional(),
  sessionId: z.string(),
  source: z.enum(['claude-code', 'codex']),
  threads: z.array(heteroSessionImportThreadSchema).optional(),
  title: z.string().optional(),
  topicClientId: z.string(),
  workingDirectory: z.string().optional(),
});
