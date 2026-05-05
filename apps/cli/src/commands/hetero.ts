import { randomUUID } from 'node:crypto';

import { spawnAgent } from '@lobechat/heterogeneous-agents/spawn';
import type { Command } from 'commander';

import { log } from '../utils/logger';

const SUPPORTED_AGENT_TYPES = new Set(['claude-code', 'codex']);

interface ExecOptions {
  command?: string;
  cwd?: string;
  operationId?: string;
  prompt?: string;
  resume?: string;
  type: string;
}

/**
 * Read all of stdin to a string. Used when `--prompt -` (or `--prompt` is
 * omitted) to pull the user prompt from a pipe / heredoc.
 */
const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const resolvePrompt = async (raw: string | undefined): Promise<string> => {
  if (raw === undefined || raw === '-') return readStdin();
  return raw;
};

const exec = async (options: ExecOptions): Promise<void> => {
  if (!SUPPORTED_AGENT_TYPES.has(options.type)) {
    log.error(
      `Unsupported --type "${options.type}". Supported: ${[...SUPPORTED_AGENT_TYPES].join(', ')}`,
    );
    process.exit(2);
  }

  const prompt = await resolvePrompt(options.prompt);
  if (!prompt.trim()) {
    log.error('Empty prompt. Pass --prompt <text> or pipe content via stdin.');
    process.exit(2);
  }

  // Standalone (phase 1a): no server ingest, so the operationId is just an
  // identity stamp on the JSONL stream. Generate a fresh one if the caller
  // didn't provide --operation-id; phase 1b will require it as a real
  // server-allocated id.
  const operationId = options.operationId || randomUUID();

  const handle = spawnAgent({
    agentType: options.type,
    command: options.command,
    cwd: options.cwd || process.cwd(),
    operationId,
    prompt,
    resumeSessionId: options.resume,
  });

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
