import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentContentBlock,
  AgentImageSource,
  AgentPromptInput,
} from '@lobechat/heterogeneous-agents/spawn';
import { spawnAgent } from '@lobechat/heterogeneous-agents/spawn';
import type { Command } from 'commander';

import { log } from '../utils/logger';

const SUPPORTED_AGENT_TYPES = new Set(['claude-code', 'codex']);

interface ExecOptions {
  command?: string;
  cwd?: string;
  image?: string[];
  inputJson?: string;
  operationId?: string;
  prompt?: string;
  resume?: string;
  type: string;
}

const collectImage = (value: string, previous: string[] = []): string[] => [...previous, value];

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

/**
 * Best-effort coercion of a JSON-decoded value into an `AgentPromptInput`.
 * Accepts:
 *   - `'plain text'` → single text block
 *   - `[{ type: 'text', text }, { type: 'image', source }]` → content blocks
 *   - `{ content: [...] }` (Anthropic message shape) → unwraps `content`
 *   - `{ type: 'text', ... } | { type: 'image', ... }` → single block
 */
const coerceJsonPrompt = (parsed: unknown): AgentPromptInput => {
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(parsed)) return parsed as AgentContentBlock[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.content)) return obj.content as AgentContentBlock[];
    if (obj.type === 'text' || obj.type === 'image') return [obj as AgentContentBlock];
  }
  throw new Error(
    'Invalid --input-json shape: expected a string, array of content blocks, ' +
      'or `{ content: [...] }` envelope.',
  );
};

interface ResolvedPrompt {
  /** Human-readable description for the empty-input check. */
  describe: () => string;
  prompt: AgentPromptInput;
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
const resolvePrompt = async (options: ExecOptions): Promise<ResolvedPrompt> => {
  const images = options.image ?? [];

  if (options.inputJson !== undefined) {
    if (options.prompt !== undefined) {
      throw new Error('--prompt and --input-json are mutually exclusive.');
    }
    if (images.length > 0) {
      throw new Error('--image cannot be combined with --input-json (put images in the JSON).');
    }
    const raw = await readInputJson(options.inputJson);
    return { describe: () => raw.trim(), prompt: coerceJsonPrompt(JSON.parse(raw)) };
  }

  if (options.prompt !== undefined && options.prompt !== '-') {
    return buildPromptFromText(options.prompt, images);
  }

  // No --prompt or --prompt -: read stdin and auto-detect.
  const raw = await readStdin();
  if (looksLikeJsonInput(raw)) {
    return { describe: () => raw.trim(), prompt: coerceJsonPrompt(JSON.parse(raw)) };
  }
  return buildPromptFromText(raw, images);
};

const exec = async (options: ExecOptions): Promise<void> => {
  if (!SUPPORTED_AGENT_TYPES.has(options.type)) {
    log.error(
      `Unsupported --type "${options.type}". Supported: ${[...SUPPORTED_AGENT_TYPES].join(', ')}`,
    );
    process.exit(2);
  }

  let resolved: ResolvedPrompt;
  try {
    resolved = await resolvePrompt(options);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  if (!resolved.describe()) {
    log.error(
      'Empty prompt. Pass --prompt <text>, --image <path>, --input-json <file|->, or pipe content via stdin.',
    );
    process.exit(2);
  }

  // Standalone (phase 1a): no server ingest, so the operationId is just an
  // identity stamp on the JSONL stream. Generate a fresh one if the caller
  // didn't provide --operation-id; phase 1b will require it as a real
  // server-allocated id.
  const operationId = options.operationId || randomUUID();

  // `spawnAgent` is async and can reject DURING image normalization — fetch
  // failures, missing local --image paths, decode errors. Surface those as a
  // clean error + exit code instead of an unhandled promise rejection / stack
  // trace, mirroring the validation try/catch above.
  let handle: Awaited<ReturnType<typeof spawnAgent>>;
  try {
    handle = await spawnAgent({
      agentType: options.type,
      command: options.command,
      cwd: options.cwd || process.cwd(),
      operationId,
      prompt: resolved.prompt,
      resumeSessionId: options.resume,
    });
  } catch (err) {
    log.error('Failed to start agent:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Forward the child's stderr to ours so users see CLI errors / warnings
  // (auth prompts, missing-binary errors, etc.) in the terminal.
  handle.stderr.pipe(process.stderr);

  // Ctrl-C → SIGINT to the child's process group so the spawned CLI gets a
  // chance to clean up. Repeated Ctrl-C escalates to SIGKILL via the
  // standard "double-tap" pattern most CLIs implement themselves.
  let interrupted = false;
  const onSigint = () => {
    if (interrupted) {
      handle.kill('SIGKILL');
      return;
    }
    interrupted = true;
    handle.kill('SIGINT');
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', () => handle.kill('SIGTERM'));

  // Stream events out as JSONL on stdout. Each line is one `AgentStreamEvent`.
  // Use raw write (not console.log) so we don't pull in console formatting
  // and JSONL stays parseable downstream.
  try {
    for await (const event of handle.events) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
  } catch (err) {
    log.error('Stream error from agent process:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    process.off('SIGINT', onSigint);
  }

  // Pass the child's exit code through. Signal-induced exits (SIGINT etc.)
  // surface as `code === null` — map to 130 (POSIX convention for SIGINT).
  const { code, signal } = await handle.exit;
  if (code !== null) process.exit(code);
  if (signal === 'SIGINT') process.exit(130);
  if (signal === 'SIGTERM') process.exit(143);
  if (signal === 'SIGKILL') process.exit(137);
  process.exit(1);
};

export function registerHeteroCommand(program: Command) {
  const hetero = program
    .command('hetero')
    .description('Run heterogeneous agent CLIs (Claude Code / Codex) and stream their output');

  hetero
    .command('exec')
    .description(
      'Spawn a heterogeneous agent CLI and stream its events as JSONL on stdout. Standalone mode (no server ingest).',
    )
    .requiredOption('-t, --type <type>', `Agent type: ${[...SUPPORTED_AGENT_TYPES].join(' | ')}`)
    .option('-p, --prompt [text]', 'Prompt text. Pass `-` (or omit the value) to read from stdin.')
    .option(
      '-i, --image <path|url>',
      'Attach an image (repeatable). Accepts a local path, http(s) URL, or data: URL.',
      collectImage,
    )
    .option(
      '--input-json <path>',
      'Read full multimodal prompt as JSON content blocks from a file. Use `-` for stdin.',
    )
    .option('-r, --resume <sessionId>', 'Resume an existing agent session by its native id')
    .option('-d, --cwd <path>', 'Working directory for the spawned agent (default: process.cwd())')
    .option(
      '-c, --command <bin>',
      'Override the agent CLI binary name (default: `claude` or `codex`)',
    )
    .option(
      '--operation-id <id>',
      'Operation id stamped onto every emitted event. Generated as a uuid if omitted (phase 1a).',
    )
    .action(exec);
}
