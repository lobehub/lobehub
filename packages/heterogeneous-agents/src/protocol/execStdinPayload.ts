import type { AgentContentBlock } from './types';

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
 * the user prompt, then image blocks.
 */
export const buildHeteroExecStdinPayload = (params: {
  imageList?: HeteroExecImageRef[];
  prompt: string;
  systemContext?: string;
}): string => {
  const { imageList = [], prompt, systemContext } = params;
  if (!systemContext && imageList.length === 0) return JSON.stringify(prompt);

  const blocks: AgentContentBlock[] = [];
  if (systemContext) blocks.push({ text: systemContext, type: 'text' });
  blocks.push({ text: prompt, type: 'text' });
  for (const image of imageList) {
    blocks.push({ source: { id: image.id, type: 'url', url: image.url }, type: 'image' });
  }
  return JSON.stringify(blocks);
};
