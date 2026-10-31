/**
 * Agent types whose input builder turns image blocks into something the CLI
 * reads (stream-json base64, `--image`, `--file`, ACP image parts, …). See
 * `spawn/input/buildAgentInput.ts` and `spawn/grokAcpSession.ts`.
 *
 * Everything else is text-only: Cursor, Droid, Devin and TRAE throw on image
 * blocks, DeepSeek Harness sends only the prompt text, and remote-task agents
 * (OpenClaw, Hermes) have no image path. Unknown types default to unsupported,
 * so a new adapter has to opt in here once it serialises images.
 */
const IMAGE_INPUT_AGENT_TYPES = new Set<string>([
  'amp',
  'claude-code',
  'codebuddy',
  'codex',
  'grok-build',
  'kimi-code',
  'opencode',
  'pi',
  'qoder',
]);

export const heteroAgentSupportsImageInput = (type?: string | null): boolean =>
  !!type && IMAGE_INPUT_AGENT_TYPES.has(type);
