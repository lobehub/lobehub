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
 * Resolve the on-disk transcript path the CC CLI reads for `--resume`:
 * `<home>/.claude/projects/<encode(realpath(cwd))>/<sessionId>.jsonl`.
 *
 * `cwd` is realpath-resolved (symlinks + macOS `/tmp` → `/private/tmp`) to
 * match the directory the CLI itself computes; a missing/invalid cwd falls back
 * to the literal path.
 */
export const resolveClaudeCodeTranscriptPath = async (params: {
  cwd: string;
  home?: string;
  sessionId: string;
}): Promise<string> => {
  const { cwd, sessionId } = params;
  const home = params.home ?? homedir();
  let realCwd = cwd;
  try {
    realCwd = await realpath(cwd);
  } catch {
    // cwd may not exist yet — fall back to the literal path, same as the CLI
  }
  return path.join(
    home,
    '.claude',
    'projects',
    encodeClaudeProjectDir(realCwd),
    `${sessionId}.jsonl`,
  );
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

export type EnsureResumeTranscriptReason =
  'exists' | 'no-messages' | 'empty-transcript' | 'written';

export interface EnsureResumeTranscriptResult {
  path: string;
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
 * No-ops when the transcript already exists (never clobbers a live session).
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
