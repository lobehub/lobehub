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
 * retry after native resume fails. The agent's own env (`agentEnv`) rides in
 * the same envelope rather than the wrapper's process env, so it lands on top
 * of the agent's preset env exactly like a local spawn and never in argv.
 *
 * `isNewSession` is the caller's own `!resumeSessionId`. The fallback prompt is
 * always a new session by definition — it exists precisely because native
 * resume failed and the CLI is starting the agent from scratch — so it carries
 * session-scoped context regardless of what the primary attempt got.
 */
export const buildHeteroExecStdinPayload = (params: {
  /** Env from the agent's own config, applied over the agent's preset env. */
  agentEnv?: Record<string, string>;
  imageList?: HeteroExecImageRef[];
  isNewSession?: boolean;
  prompt: string;
  resumeFallbackSystemContext?: string;
  systemContext?: string;
}): string => {
  const {
    agentEnv,
    imageList = [],
    isNewSession,
    prompt,
    resumeFallbackSystemContext,
    systemContext,
  } = params;
  const blocks = buildHeterogeneousPrompt({ imageList, isNewSession, prompt, systemContext });

  const hasAgentEnv = !!agentEnv && Object.keys(agentEnv).length > 0;
  if (resumeFallbackSystemContext !== undefined || hasAgentEnv) {
    return JSON.stringify({
      ...(hasAgentEnv ? { agentEnv } : {}),
      content: blocks,
      ...(resumeFallbackSystemContext !== undefined
        ? {
            resumeFallback: buildHeterogeneousPrompt({
              imageList,
              isNewSession: true,
              prompt,
              systemContext: resumeFallbackSystemContext,
            }),
          }
        : {}),
    });
  }

  if (blocks.length === 1 && blocks[0].type === 'text' && blocks[0].text === prompt) {
    return JSON.stringify(prompt);
  }

  return JSON.stringify(blocks);
};
