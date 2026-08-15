import { PassThrough } from 'node:stream';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import type { UploadHeterogeneousImage } from '../spawn/agentStreamPipeline';
import { normalizeImage } from '../spawn/input/normalizeImage';
import type { AgentPromptInput } from '../protocol';
import { PiRpcSession } from './piRpcSession';
import type { PiRpcImage } from './piRpcProtocol';

/** Options mirroring the `spawnAgent` shape the CLI passes for one agent run. */
export interface PiRpcAgentHandleOptions {
  args: string[];
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  operationId: string;
  /** Text + base64 images for the RPC `prompt` command. */
  prompt: { text: string; images?: PiRpcImage[] };
  resumeSessionId?: string;
  uploadImage?: UploadHeterogeneousImage;
}

/**
 * Result shaped like `spawnAgent`'s `SpawnAgentHandle` so the `lh hetero exec`
 * CLI can route pi runs through the RPC transport without changing its event
 * loop, signal handling, or finish/classification plumbing.
 */
export interface PiRpcAgentHandle {
  events: AsyncIterable<AgentStreamEvent>;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill: (signal?: NodeJS.Signals) => void;
  pid: number | undefined;
  readonly sessionId: string | undefined;
  stderr: NodeJS.ReadableStream;
}

interface EventQueue {
  push: (batch: AgentStreamEvent[]) => void;
  close: () => void;
  [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent>;
}

/** Buffered async iterator with a close signal — bridges push to pull. */
const createEventQueue = (): EventQueue => {
  const items: AgentStreamEvent[] = [];
  const waiters: Array<() => void> = [];
  let closed = false;

  const notify = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };

  return {
    push(batch) {
      items.push(...batch);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (items.length > 0) {
          yield items.shift()!;
        }
        if (closed) return;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
  };
};

/**
 * Convert `AgentPromptInput` (string | text/image blocks) into the RPC prompt
 * payload: text blocks joined, image blocks normalized to base64 (URL fetch /
 * path read / base64 passthrough, cached under the agent cache dir).
 */
export const toPiRpcPrompt = async (
  input: AgentPromptInput,
  options: { cacheDir?: string } = {},
): Promise<{ images?: PiRpcImage[]; text: string }> => {
  const blocks = typeof input === 'string' ? [{ text: input, type: 'text' as const }] : input;
  const text: string[] = [];
  const images: PiRpcImage[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text) text.push(block.text);
      continue;
    }
    try {
      const image = await normalizeImage(block.source, options);
      images.push({
        data: image.buffer.toString('base64'),
        mimeType: image.mediaType,
        type: 'image',
      });
    } catch {
      // One broken attachment must not fail the whole run — the text still goes.
    }
  }

  return {
    ...(images.length > 0 ? { images } : {}),
    text: text.join('\n\n'),
  };
};

/**
 * Spawn one pi run over the RPC transport and expose it as a `spawnAgent`
 *-shaped handle. Eagerly starts the process + handshake (rejects on
 * spawn/handshake failure — the CLI surfaces it via its existing catch), then
 * runs the prompt. `kill('SIGINT')` maps to a graceful `abort`; other signals
 * escalate through the EOF-first shutdown.
 */
export const createPiRpcAgentHandle = async (
  options: PiRpcAgentHandleOptions,
): Promise<PiRpcAgentHandle> => {
  const queue = createEventQueue();
  const stderr = new PassThrough();
  let nativeSessionId: string | undefined;

  const session = new PiRpcSession({
    args: options.args,
    commandPath: options.commandPath,
    cwd: options.cwd,
    env: options.env,
    operationId: options.operationId,
    resumeSessionId: options.resumeSessionId,
    sessionId: options.operationId,
    uploadImage: options.uploadImage,
    onEvents: (events) => queue.push(events),
    onRuntimeStatus: () => {
      /* no-op — the CLI surfaces state via events */
    },
    onSessionId: (id) => {
      nativeSessionId = id;
    },
    onStderr: (data) => {
      stderr.write(data);
    },
  });

  // Eager spawn + handshake: a missing/broken pi install rejects here so the
  // CLI's existing spawn-failure classification runs.
  await session.start();

  const exit = session
    .run(options.prompt)
    .then(() => {
      queue.close();
      stderr.end();
      return { code: 0, signal: null as NodeJS.Signals | null };
    })
    .catch(() => {
      queue.close();
      stderr.end();
      return { code: 1, signal: null as NodeJS.Signals | null };
    });

  return {
    events: queue,
    exit,
    kill: (signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        void session.close().catch(() => {
          /* best-effort */
        });
      } else {
        void session.abort().catch(() => {
          /* best-effort */
        });
      }
    },
    pid: session.pid,
    get sessionId() {
      return nativeSessionId;
    },
    stderr,
  };
};
