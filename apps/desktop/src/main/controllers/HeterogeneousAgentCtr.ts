import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { app as electronApp, BrowserWindow } from 'electron';

import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:HeterogeneousAgentCtr');

/** Directory under appStoragePath for caching downloaded files */
const FILE_CACHE_DIR = 'heteroAgent/files';

// ─── CLI presets per agent type ───
// Mirrors @lobechat/heterogeneous-agents/registry but runs in main process
// (can't import from the workspace package in Electron main directly)

interface CLIPreset {
  baseArgs: string[];
  promptMode: 'positional' | 'stdin';
  resumeArgs?: (sessionId: string) => string[];
}

const CLI_PRESETS: Record<string, CLIPreset> = {
  'claude-code': {
    baseArgs: [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'bypassPermissions',
    ],
    promptMode: 'positional',
    resumeArgs: (sid) => ['--resume', sid],
  },
  // Future presets:
  // 'codex': { baseArgs: [...], promptMode: 'positional' },
  // 'kimi-cli': { baseArgs: [...], promptMode: 'positional' },
};

// ─── IPC types ───

interface StartSessionParams {
  /** Agent type key (e.g., 'claude-code'). Defaults to 'claude-code'. */
  agentType?: string;
  /** Additional CLI arguments */
  args?: string[];
  /** Command to execute */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Session ID to resume (for multi-turn) */
  resumeSessionId?: string;
}

interface StartSessionResult {
  sessionId: string;
}

interface ImageAttachment {
  id: string;
  url: string;
}

interface SendPromptParams {
  /** Image attachments to include in the prompt (downloaded from url, cached by id) */
  imageList?: ImageAttachment[];
  prompt: string;
  sessionId: string;
}

interface CancelSessionParams {
  sessionId: string;
}

interface StopSessionParams {
  sessionId: string;
}

interface GetSessionInfoParams {
  sessionId: string;
}

interface SessionInfo {
  agentSessionId?: string;
}

// ─── Internal session tracking ───

interface AgentSession {
  agentSessionId?: string;
  agentType: string;
  args: string[];
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  process?: ChildProcess;
  sessionId: string;
}

/**
 * External Agent Controller — manages external agent CLI processes via Electron IPC.
 *
 * Agent-agnostic: uses CLI presets from a registry to support Claude Code,
 * Codex, Kimi CLI, etc. Only handles process lifecycle and raw stdout line
 * broadcasting. All event parsing and DB persistence happens on the Renderer side.
 *
 * Lifecycle: startSession → sendPrompt → (heteroAgentRawLine broadcasts) → stopSession
 */
export default class HeterogeneousAgentCtr extends ControllerModule {
  static override readonly groupName = 'heterogeneousAgent';

  private sessions = new Map<string, AgentSession>();

  // ─── Broadcast ───

  private broadcast<T>(channel: string, data: T) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }

  // ─── File cache ───

  private get fileCacheDir(): string {
    return join(this.app.appStoragePath, FILE_CACHE_DIR);
  }

  /**
   * Derive a filesystem-safe cache key for attachments.
   *
   * Never use the raw image id as a path segment — upstream callers can persist
   * arbitrary ids and path.join would treat traversal sequences as real
   * directories. A stable hash preserves cache hits without trusting the id as a
   * filename.
   */
  private getImageCacheKey(imageId: string): string {
    return createHash('sha256').update(imageId).digest('hex');
  }

  /**
   * Download an image by URL, with local disk cache keyed by id.
   */
  private async resolveImage(
    image: ImageAttachment,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const cacheDir = this.fileCacheDir;
    const cacheKey = this.getImageCacheKey(image.id);
    const metaPath = join(cacheDir, `${cacheKey}.meta`);
    const dataPath = join(cacheDir, cacheKey);

    // Check cache first
    try {
      const metaRaw = await readFile(metaPath, 'utf8');
      const meta = JSON.parse(metaRaw);
      const buffer = await readFile(dataPath);
      logger.debug('Image cache hit:', image.id);
      return { buffer, mimeType: meta.mimeType || 'image/png' };
    } catch {
      // Cache miss — download
    }

    logger.info('Downloading image:', image.id);

    const res = await fetch(image.url);
    if (!res.ok)
      throw new Error(`Failed to download image ${image.id}: ${res.status} ${res.statusText}`);

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = res.headers.get('content-type') || 'image/png';

    // Write to cache
    await mkdir(cacheDir, { recursive: true });
    await writeFile(dataPath, buffer);
    await writeFile(metaPath, JSON.stringify({ id: image.id, mimeType }));
    logger.debug('Image cached:', image.id, `${buffer.length} bytes`);

    return { buffer, mimeType };
  }

  /**
   * Build a stream-json user message with text + image content blocks.
   */
  private async buildStreamJsonInput(
    prompt: string,
    imageList: ImageAttachment[],
  ): Promise<string> {
    const content: any[] = [{ text: prompt, type: 'text' }];

    for (const image of imageList) {
      try {
        const { buffer, mimeType } = await this.resolveImage(image);
        content.push({
          source: {
            data: buffer.toString('base64'),
            media_type: mimeType,
            type: 'base64',
          },
          type: 'image',
        });
      } catch (err) {
        logger.error(`Failed to resolve image ${image.id}:`, err);
      }
    }

    return JSON.stringify({
      message: { content, role: 'user' },
      type: 'user',
    });
  }

  // ─── IPC methods ───

  /**
   * Create a session (stores config, process spawned on sendPrompt).
   */
  @IpcMethod()
  async startSession(params: StartSessionParams): Promise<StartSessionResult> {
    const sessionId = randomUUID();
    const agentType = params.agentType || 'claude-code';

    this.sessions.set(sessionId, {
      // If resuming, pre-set the agent session ID so sendPrompt adds --resume
      agentSessionId: params.resumeSessionId,
      agentType,
      args: params.args || [],
      command: params.command,
      cwd: params.cwd,
      env: params.env,
      sessionId,
    });

    logger.info('Session created:', { agentType, sessionId });
    return { sessionId };
  }

  /**
   * Send a prompt to an agent session.
   *
   * Spawns the CLI process with preset flags. Broadcasts each stdout line
   * as an `heteroAgentRawLine` event — Renderer side parses and adapts.
   */
  @IpcMethod()
  async sendPrompt(params: SendPromptParams): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Session not found: ${params.sessionId}`);

    const preset = CLI_PRESETS[session.agentType];
    if (!preset) throw new Error(`Unknown agent type: ${session.agentType}`);

    const hasImages = params.imageList && params.imageList.length > 0;

    // If images are attached, prepare the stream-json input BEFORE spawning
    // so any download errors are caught early.
    let stdinPayload: string | undefined;
    if (hasImages) {
      stdinPayload = await this.buildStreamJsonInput(params.prompt, params.imageList!);
    }

    return new Promise<void>((resolve, reject) => {
      // Build CLI args: base preset + resume + user args
      const cliArgs = [
        ...preset.baseArgs,
        ...(session.agentSessionId && preset.resumeArgs
          ? preset.resumeArgs(session.agentSessionId)
          : []),
        ...session.args,
      ];

      if (hasImages) {
        // With files: use stdin stream-json mode
        cliArgs.push('--input-format', 'stream-json');
      } else {
        // Without files: use positional prompt (simple mode)
        if (preset.promptMode === 'positional') {
          cliArgs.push(params.prompt);
        }
      }

      logger.info('Spawning agent:', session.command, cliArgs.join(' '));

      const proc = spawn(session.command, cliArgs, {
        cwd: session.cwd,
        env: { ...process.env, ...session.env },
        stdio: [hasImages ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });

      // If using stdin mode, write the stream-json message and close stdin
      if (hasImages && stdinPayload && proc.stdin) {
        const stdin = proc.stdin as Writable;
        stdin.write(stdinPayload + '\n', () => {
          stdin.end();
        });
      }

      session.process = proc;
      let buffer = '';

      // Stream stdout lines as raw events to Renderer
      const stdout = proc.stdout as Readable;
      stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed);

            // Extract agent session ID from init event (for multi-turn)
            if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.session_id) {
              session.agentSessionId = parsed.session_id;
            }

            // Broadcast raw parsed JSON — Renderer handles all adaptation
            this.broadcast('heteroAgentRawLine', {
              line: parsed,
              sessionId: session.sessionId,
            });
          } catch {
            // Not valid JSON, skip
          }
        }
      });

      // Capture stderr
      const stderrChunks: string[] = [];
      const stderr = proc.stderr as Readable;
      stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString('utf8'));
      });

      proc.on('error', (err) => {
        logger.error('Agent process error:', err);
        this.broadcast('heteroAgentSessionError', {
          error: err.message,
          sessionId: session.sessionId,
        });
        reject(err);
      });

      proc.on('exit', (code) => {
        logger.info('Agent process exited:', { code, sessionId: session.sessionId });
        session.process = undefined;

        if (code === 0) {
          this.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
          resolve();
        } else {
          const stderrOutput = stderrChunks.join('').trim();
          const errorMsg = stderrOutput || `Agent exited with code ${code}`;
          this.broadcast('heteroAgentSessionError', {
            error: errorMsg,
            sessionId: session.sessionId,
          });
          reject(new Error(errorMsg));
        }
      });
    });
  }

  /**
   * Get session info (agent's internal session ID for multi-turn resume).
   */
  @IpcMethod()
  async getSessionInfo(params: GetSessionInfoParams): Promise<SessionInfo> {
    const session = this.sessions.get(params.sessionId);
    return { agentSessionId: session?.agentSessionId };
  }

  /**
   * Cancel an ongoing session.
   */
  @IpcMethod()
  async cancelSession(params: CancelSessionParams): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (session?.process) {
      session.process.kill('SIGINT');
    }
  }

  /**
   * Stop and clean up a session.
   */
  @IpcMethod()
  async stopSession(params: StopSessionParams): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) return;

    if (session.process && !session.process.killed) {
      session.process.kill('SIGTERM');
      setTimeout(() => {
        if (session.process && !session.process.killed) {
          session.process.kill('SIGKILL');
        }
      }, 3000);
    }

    this.sessions.delete(params.sessionId);
  }

  @IpcMethod()
  async respondPermission(): Promise<void> {
    // No-op for CLI mode (permissions handled by --permission-mode flag)
  }

  /**
   * Cleanup on app quit.
   */
  afterAppReady() {
    electronApp.on('before-quit', () => {
      for (const [, session] of this.sessions) {
        if (session.process && !session.process.killed) {
          session.process.kill('SIGTERM');
        }
      }
      this.sessions.clear();
    });
  }
}
