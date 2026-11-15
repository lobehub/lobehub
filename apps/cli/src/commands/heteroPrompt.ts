import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentContentBlock,
  AgentImageSource,
  AgentPromptInput,
} from '@lobechat/heterogeneous-agents/spawn';

import type { ExecOptions } from './hetero';

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Resolve a raw `--input-json` argument: `'-'` (or empty) reads stdin, anything
 * else is treated as a filesystem path.
 */
const readInputJson = async (location: string): Promise<string> => {
  if (location === '-' || location === '') return readStdin();
  return readFile(location, 'utf8');
};

const looksLikeJsonInput = (value: string): boolean => {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

/**
 * Convert an `--image <value>` argument into an image source. Recognized
 * shapes: `https?://...` URL, `data:` URL, otherwise a filesystem path
 * resolved relative to the CLI's cwd.
 */
const parseImageArg = (value: string): AgentImageSource => {
  if (/^https?:\/\//i.test(value)) return { type: 'url', url: value };
  if (value.startsWith('data:')) {
    const match = value.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) {
      throw new Error(`Invalid data URL for --image: ${value.slice(0, 40)}…`);
    }
    return { data: match[2]!, mediaType: match[1]!, type: 'base64' };
  }
  return { path: path.resolve(process.cwd(), value), type: 'path' };
};

/** The envelope's `agentEnv`, keeping only string values; anything else is dropped. */
const coerceAgentEnv = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/**
 * Best-effort coercion of a JSON-decoded value into an `AgentPromptInput`.
 * Accepts:
 *   - `'plain text'` → single text block
 *   - `[{ type: 'text', text }, { type: 'image', source }]` → content blocks
 *   - `{ content: [...], resumeFallback?: [...], agentEnv?: {...} }` → unwraps
 *     the primary prompt, reserves the fallback for a retry without native
 *     resume, and keeps the agent's own env for the spawn
 *   - `{ type: 'text', ... } | { type: 'image', ... }` → single block
 */
export const coerceJsonPrompt = (
  parsed: unknown,
): Pick<ResolvedPrompt, 'agentEnv' | 'prompt' | 'resumeFallbackPrompt'> => {
  if (typeof parsed === 'string') return { prompt: parsed };
  if (Array.isArray(parsed)) return { prompt: parsed as AgentContentBlock[] };
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      const agentEnv = coerceAgentEnv(obj.agentEnv);
      return {
        ...(agentEnv ? { agentEnv } : {}),
        prompt: obj.content as AgentContentBlock[],
        ...(Array.isArray(obj.resumeFallback)
          ? { resumeFallbackPrompt: obj.resumeFallback as AgentContentBlock[] }
          : {}),
      };
    }
    if (obj.type === 'text' || obj.type === 'image') {
      return { prompt: [obj as unknown as AgentContentBlock] };
    }
  }
  throw new Error(
    'Invalid --input-json shape: expected a string, array of content blocks, ' +
      'or `{ content: [...] }` envelope.',
  );
};

export interface ResolvedPrompt {
  /**
   * Env from the agent's own config (dispatch envelope only). Applied over the
   * run identity and the agent's preset env, as a local spawn applies it.
   */
  agentEnv?: Record<string, string>;
  /** Human-readable description for the empty-input check. */
  describe: () => string;
  prompt: AgentPromptInput;
  /** Full prompt used only when native resume fails and the CLI retries fresh. */
  resumeFallbackPrompt?: AgentPromptInput;
}

const buildPromptFromText = (text: string, images: string[]): ResolvedPrompt => {
  if (images.length === 0) {
    return { describe: () => text.trim(), prompt: text };
  }
  const blocks: AgentContentBlock[] = [];
  if (text.length > 0) blocks.push({ text, type: 'text' });
  for (const image of images) {
    blocks.push({ source: parseImageArg(image), type: 'image' });
  }
  return {
    describe: () =>
      blocks
        .map((b) => (b.type === 'text' ? b.text.trim() : '[image]'))
        .filter(Boolean)
        .join(' ')
        .trim(),
    prompt: blocks,
  };
};

/**
 * Decide which input mode the user requested and produce a unified prompt.
 *
 * Mode resolution (mutually exclusive):
 *   1. `--input-json` → read JSON file or stdin, parse to content blocks
 *   2. `--prompt` (with optional `--image` flags) → text + images
 *   3. (default) read stdin: auto-detect JSON vs plain text by first char
 */
export const resolvePrompt = async (
  options: Pick<ExecOptions, 'image' | 'inputJson' | 'prompt'>,
): Promise<ResolvedPrompt> => {
  const images = options.image ?? [];

  if (options.inputJson !== undefined) {
    if (options.prompt !== undefined) {
      throw new Error('--prompt and --input-json are mutually exclusive.');
    }
    if (images.length > 0) {
      throw new Error('--image cannot be combined with --input-json (put images in the JSON).');
    }
    const raw = await readInputJson(options.inputJson);
    return { describe: () => raw.trim(), ...coerceJsonPrompt(JSON.parse(raw)) };
  }

  if (options.prompt !== undefined && options.prompt !== '-') {
    return buildPromptFromText(options.prompt, images);
  }

  // No --prompt or --prompt -: read stdin and auto-detect.
  const raw = await readStdin();
  if (looksLikeJsonInput(raw)) {
    return { describe: () => raw.trim(), ...coerceJsonPrompt(JSON.parse(raw)) };
  }
  return buildPromptFromText(raw, images);
};
