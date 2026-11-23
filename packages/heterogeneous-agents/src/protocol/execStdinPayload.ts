import type { CodexCollaborationMode, HeteroPermissionMode } from '@lobechat/types';

import { buildHeterogeneousPrompt } from './promptEngine';

/**
 * Image attachment reference carried through the hetero dispatch protocols
 * (gateway `agent_run_request`, sandbox runner). The URL must be fetchable by
 * the executing CLI (e.g. a signed S3 URL) — `lh hetero exec` resolves it via
 * `normalizeImage` into base64 (Claude Code) or a materialized file path
 * (Codex `--image`).
 */
export interface HeteroExecImageRef {
  /** Stable file id, forwarded into the image source for cache dedupe. */
  id?: string;
  /** Resolved URL the executing CLI can fetch. */
  url: string;
}

/**
 * Build the `--input-json` stdin payload for a dispatched `lh hetero exec`
 * run. Shared by every dispatch site (desktop `spawnLhHeteroExec`, the
 * `lh connect` daemon's agent-run handler, and the server sandbox runner) so
 * the payload shape can't drift between them.
 *
 * Plain prompt with no context/images stays a JSON string (the historical
 * shape); anything richer becomes a content-block array, which
 * `lh hetero exec` coerces via `coerceJsonPrompt` — systemContext first, then
 * the user prompt, then image blocks. Resume recovery adds a backwards-
 * compatible `{ content, resumeFallback }` envelope: old CLIs unwrap `content`
 * and run the primary prompt, while new CLIs reserve `resumeFallback` for a
 * retry after native resume fails.
 *
 * `isNewSession` is the caller's own `!resumeSessionId`. The fallback prompt is
 * always a new session by definition — it exists precisely because native
 * resume failed and the CLI is starting the agent from scratch — so it carries
 * session-scoped context regardless of what the primary attempt got.
 *
 * `permissionMode` (Claude Code) rides the same
 * envelope for the same reason: an `lh` that predates it unwraps `content` and
 * keeps allowing everything, rather than failing on an unknown flag. The
 * Codex Plan switch (`collaborationMode`) rides it for the same reason.
 */
export const buildHeteroExecStdinPayload = (params: {
  collaborationMode?: CodexCollaborationMode;
  imageList?: HeteroExecImageRef[];
  isNewSession?: boolean;
  permissionMode?: HeteroPermissionMode;
  prompt: string;
  resumeFallbackSystemContext?: string;
  systemContext?: string;
}): string => {
  const {
    collaborationMode,
    imageList = [],
    isNewSession,
    permissionMode,
    prompt,
    resumeFallbackSystemContext,
    systemContext,
  } = params;
  const blocks = buildHeterogeneousPrompt({ imageList, isNewSession, prompt, systemContext });

  if (resumeFallbackSystemContext !== undefined || permissionMode || collaborationMode) {
    return JSON.stringify({
      ...(collaborationMode && { collaborationMode }),
      content: blocks,
      ...(permissionMode && { permissionMode }),
      resumeFallback:
        resumeFallbackSystemContext === undefined
          ? undefined
          : buildHeterogeneousPrompt({
              imageList,
              isNewSession: true,
              prompt,
              systemContext: resumeFallbackSystemContext,
            }),
    });
  }

  if (blocks.length === 1 && blocks[0].type === 'text' && blocks[0].text === prompt) {
    return JSON.stringify(prompt);
  }

  return JSON.stringify(blocks);
};
