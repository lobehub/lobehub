import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { HeteroSessionImportMessage } from '@lobechat/types';

import {
  buildClaudeCodeTranscript,
  type BuildClaudeCodeTranscriptOptions,
  encodeClaudeProjectDir,
} from '../transcript/rebuildClaudeCode';

/**
 * The CLI's own session-id gate: a lowercase-hex UUID. Anything else resolves to
 * `invalid-resume-id.jsonl` there and can never be resumed, so rejecting it
 * early costs nothing.
 *
 * This is also a SECURITY boundary. `heteroSessionId` is stored on topic
 * metadata as an unconstrained string (`chatTopicMetadataUpdateSchema`), so on a
 * shared topic any collaborator who can patch metadata controls this value. It
 * is interpolated into a filesystem path, and `path.join` happily collapses
 * `..` segments — `../../../../tmp/x` escapes the projects directory entirely.
 */
const CLAUDE_SESSION_ID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export const isValidClaudeSessionId = (sessionId: string): boolean =>
  CLAUDE_SESSION_ID_RE.test(sessionId);

/**
 * Resolve the on-disk transcript path the CC CLI reads for `--resume`:
 * `<home>/.claude/projects/<encode(realpath(cwd))>/<sessionId>.jsonl`.
 *
 * `cwd` is realpath-resolved (symlinks + macOS `/tmp` → `/private/tmp`) to
 * match the directory the CLI itself computes; a missing/invalid cwd falls back
 * to the literal path. The cwd segment is sanitized by `encodeClaudeProjectDir`
 * (every non-alphanumeric char becomes `-`), so only `sessionId` can carry
 * traversal — it is rejected unless it matches the CLI's UUID format.
 *
 * Returns `null` for a session id that could not be a real CC session.
 */
export const resolveClaudeCodeTranscriptPath = async (params: {
  cwd: string;
  home?: string;
  sessionId: string;
}): Promise<string | null> => {
  const { cwd, sessionId } = params;
  if (!isValidClaudeSessionId(sessionId)) return null;

  const home = params.home ?? homedir();
  let realCwd = cwd;
  try {
    realCwd = await realpath(cwd);
  } catch {
    // cwd may not exist yet — fall back to the literal path, same as the CLI
  }
  const projectDir = path.join(home, '.claude', 'projects', encodeClaudeProjectDir(realCwd));
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);

  // Belt-and-braces: the regex already forbids separators, but assert the
  // resolved destination really is a direct child of the project directory so a
  // future change to either helper can't silently reopen the traversal.
  if (path.dirname(path.resolve(filePath)) !== path.resolve(projectDir)) return null;

  return filePath;
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

export type EnsureResumeTranscriptReason =
  'exists' | 'invalid-session-id' | 'no-messages' | 'empty-transcript' | 'written';

export interface EnsureResumeTranscriptResult {
  /** Null when the session id was rejected — nothing was touched on disk. */
  path: string | null;
  reason: EnsureResumeTranscriptReason;
  written: boolean;
}

/**
 * Ensure a resumable transcript exists before spawning CC with `--resume`.
 *
 * When the local transcript was GC'd (CC's `cleanupPeriodDays`, default 30),
 * rebuild it from the messages LobeHub still holds and write it to the path the
 * CLI expects, so `--resume <sessionId>` hydrates the native history again
 * instead of failing with "No conversation found with session ID".
 *
 * No-ops when the transcript already exists (never clobbers a live session), and
 * refuses a session id that isn't the CLI's UUID format — that value comes from
 * topic metadata a shared-topic collaborator can set, and it lands in a
 * filesystem path.
 */
export const ensureClaudeCodeResumeTranscript = async (params: {
  cwd: string;
  home?: string;
  messages: HeteroSessionImportMessage[];
  sessionId: string;
  transcriptOptions?: Partial<Omit<BuildClaudeCodeTranscriptOptions, 'cwd' | 'sessionId'>>;
}): Promise<EnsureResumeTranscriptResult> => {
  const { cwd, messages, sessionId } = params;
  const filePath = await resolveClaudeCodeTranscriptPath({ cwd, home: params.home, sessionId });
  if (!filePath) return { path: null, reason: 'invalid-session-id', written: false };

  if (await fileExists(filePath)) return { path: filePath, reason: 'exists', written: false };
  if (!messages || messages.length === 0)
    return { path: filePath, reason: 'no-messages', written: false };

  const transcript = buildClaudeCodeTranscript(messages, {
    cwd,
    sessionId,
    ...params.transcriptOptions,
  });
  if (!transcript) return { path: filePath, reason: 'empty-transcript', written: false };

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, transcript, 'utf8');
  return { path: filePath, reason: 'written', written: true };
};
