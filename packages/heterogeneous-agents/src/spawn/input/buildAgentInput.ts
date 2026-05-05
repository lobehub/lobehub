import { tmpdir } from 'node:os';
import path from 'node:path';

import type { NormalizedImage, NormalizeImageOptions } from './normalizeImage';
import { materializeImageToPath, normalizeImage } from './normalizeImage';
import type { AgentContentBlock, AgentImageBlock, AgentPromptInput, AgentTextBlock } from './types';

export interface BuildAgentInputOptions extends NormalizeImageOptions {
  /**
   * Directory used to materialize images for path-based agents (Codex). When
   * unset, falls back to `cacheDir`, then to a per-agent subdirectory under
   * the OS tmpdir. Path-input images skip materialization entirely.
   */
  imageMaterializeDir?: string;
}

/**
 * Result of preparing input for a child agent process.
 *
 * `args` is appended to the agent's CLI argv (e.g. Codex `--image <path>`
 * pairs); `stdin` is the payload written to the child's stdin (stream-json
 * for Claude Code, raw text for Codex).
 */
export interface AgentInputPlan {
  args: string[];
  stdin: string;
}

const toBlocks = (input: AgentPromptInput): AgentContentBlock[] => {
  if (typeof input === 'string') return input ? [{ text: input, type: 'text' }] : [];
  return input;
};

const isTextBlock = (b: AgentContentBlock): b is AgentTextBlock => b.type === 'text';
const isImageBlock = (b: AgentContentBlock): b is AgentImageBlock => b.type === 'image';

const collectText = (blocks: AgentContentBlock[]): string =>
  blocks
    .filter(isTextBlock)
    .map((b) => b.text)
    .filter((t) => t.length > 0)
    .join('\n\n');

const buildClaudeCodeStdin = async (
  blocks: AgentContentBlock[],
  options: BuildAgentInputOptions,
): Promise<AgentInputPlan> => {
  const content: Array<
    | { text: string; type: 'text' }
    | { source: { data: string; media_type: string; type: 'base64' }; type: 'image' }
  > = [];

  for (const block of blocks) {
    if (isTextBlock(block)) {
      if (block.text.length > 0) content.push({ text: block.text, type: 'text' });
      continue;
    }
    if (isImageBlock(block)) {
      const image = await normalizeImage(block.source, options);
      content.push({
        source: {
          data: image.buffer.toString('base64'),
          media_type: image.mediaType,
          type: 'base64',
        },
        type: 'image',
      });
    }
  }

  return {
    args: [],
    stdin: `${JSON.stringify({
      message: { content, role: 'user' },
      type: 'user',
    })}\n`,
  };
};

const resolveCodexImagePaths = async (
  blocks: AgentContentBlock[],
  options: BuildAgentInputOptions,
): Promise<string[]> => {
  const imageBlocks = blocks.filter(isImageBlock);
  if (imageBlocks.length === 0) return [];

  const materializeDir =
    options.imageMaterializeDir ||
    options.cacheDir ||
    path.join(tmpdir(), 'lobehub-hetero-agent-images');

  const normalized: NormalizedImage[] = await Promise.all(
    imageBlocks.map((b) => normalizeImage(b.source, options)),
  );

  return Promise.all(normalized.map((img) => materializeImageToPath(img, materializeDir)));
};

const buildCodexInput = async (
  blocks: AgentContentBlock[],
  options: BuildAgentInputOptions,
): Promise<AgentInputPlan> => {
  const text = collectText(blocks);
  const imagePaths = await resolveCodexImagePaths(blocks, options);

  return {
    args: imagePaths.flatMap((p) => ['--image', p]),
    stdin: text,
  };
};

/**
 * Convert a unified `AgentPromptInput` into the per-agent stdin payload + any
 * extra CLI args required to attach images. The single source of truth for
 * how each external agent CLI receives multimodal input.
 *
 * - `claude-code`: stream-json on stdin with text + base64 image content blocks
 * - `codex`: raw text on stdin + repeatable `--image <path>` flags
 *
 * Path-mode agents materialize URL / base64 images via `materializeImageToPath`
 * into `imageMaterializeDir` (defaults to `cacheDir` then `os.tmpdir()`).
 */
export const buildAgentInput = async (
  agentType: string,
  prompt: AgentPromptInput,
  options: BuildAgentInputOptions = {},
): Promise<AgentInputPlan> => {
  const blocks = toBlocks(prompt);

  switch (agentType) {
    case 'claude-code': {
      return buildClaudeCodeStdin(blocks, options);
    }
    case 'codex': {
      return buildCodexInput(blocks, options);
    }
    default: {
      throw new Error(`buildAgentInput: unsupported agent type "${agentType}"`);
    }
  }
};
