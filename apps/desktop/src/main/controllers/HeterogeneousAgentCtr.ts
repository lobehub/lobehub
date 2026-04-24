import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';
import {
  CLAUDE_CODE_CLI_INSTALL_COMMANDS,
  CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
  CODEX_CLI_INSTALL_COMMANDS,
  CODEX_CLI_INSTALL_DOCS_URL,
  HeterogeneousAgentSessionErrorCode,
} from '@lobechat/electron-client-ipc';
import { app as electronApp, BrowserWindow } from 'electron';

import { getHeterogeneousAgentDriver } from '@/modules/heterogeneousAgent';
import { CodexFileChangeTracker } from '@/modules/heterogeneousAgent/codexFileChangeTracker';
import type {
  HeterogeneousAgentImageAttachment,
  HeterogeneousAgentParsedOutput,
} from '@/modules/heterogeneousAgent/types';
import { buildProxyEnv } from '@/modules/networkProxy/envBuilder';
import { detectHeterogeneousCliCommand } from '@/modules/toolDetectors';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:HeterogeneousAgentCtr');
const CODEX_RESUME_THREAD_NOT_FOUND_PATTERNS = [
  /no conversation found/i,
  /thread .*not found/i,
  /conversation .*not found/i,
  /resume.*not found/i,
] as const;
const CLI_AUTH_REQUIRED_PATTERNS = [
  /failed to authenticate/i,
  /invalid authentication credentials/i,
  /authentication[_ ]error/i,
  /not authenticated/i,
  /\bunauthorized\b/i,
  /\b401\b/,
] as const;
const CODEX_RESUME_CWD_MISMATCH_PATTERNS = [
  /working directory/i,
  /\bcwd\b/i,
  /different directory/i,
  /directory.*mismatch/i,
] as const;

/** Directory under appStoragePath for caching downloaded files */
const FILE_CACHE_DIR = 'heteroAgent/files';

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

interface SendPromptParams {
  /** Image attachments to include in the prompt (downloaded from url, cached by id) */
  imageList?: HeterogeneousAgentImageAttachment[];
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
  /**
   * True when *we* initiated the kill (cancelSession / stopSession / before-quit).
   * The `exit` handler uses this to route signal-induced non-zero exits through
   * the `complete` broadcast instead of surfacing them as runtime errors —
   * SIGINT(130) / SIGTERM(143) / SIGKILL(137) from our own kill paths are
   * intentional, not agent failures.
   */
  cancelledByUs?: boolean;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  process?: ChildProcess;
  resumeSessionId?: string;
  sessionId: string;
}

type SessionErrorPayload = HeterogeneousAgentSessionError | string;

/**
 * External Agent Controller — manages external agent CLI processes via Electron IPC.
 *
 * Agent-agnostic: delegates spawn-plan construction and stdout framing to a
 * per-agent driver so Claude Code, Codex, and future CLIs can differ in
 * prompt transport, resume semantics, and raw stream shape without turning
 * this controller into a giant `switch`.
 *
 * Lifecycle: startSession → sendPrompt → (heteroAgentRawLine broadcasts) → stopSession
 */
export default class HeterogeneousAgentCtr extends ControllerModule {
  static override readonly groupName = 'heterogeneousAgent';

  private sessions = new Map<string, AgentSession>();

  private resolveSessionCommand(session: AgentSession): string {
    const resolvedCommand = session.command.trim();
    if (resolvedCommand) return resolvedCommand;

    return session.agentType === 'codex' ? 'codex' : 'claude';
  }

  private buildCodexCliMissingError(session: AgentSession): HeterogeneousAgentSessionError {
    const command = this.resolveSessionCommand(session);

    return {
      agentType: 'codex',
      code: HeterogeneousAgentSessionErrorCode.CliNotFound,
      command,
      docsUrl: CODEX_CLI_INSTALL_DOCS_URL,
      installCommands: CODEX_CLI_INSTALL_COMMANDS,
      message: `Codex CLI was not found. Install it and make sure \`${command}\` can be executed.`,
    };
  }

  private buildClaudeCodeCliMissingError(session: AgentSession): HeterogeneousAgentSessionError {
    const command = this.resolveSessionCommand(session);

    return {
      agentType: 'claude-code',
      code: HeterogeneousAgentSessionErrorCode.CliNotFound,
      command,
      docsUrl: CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
      installCommands: CLAUDE_CODE_CLI_INSTALL_COMMANDS,
      message: `Claude Code CLI was not found. Install it and make sure \`${command}\` can be executed.`,
    };
  }

  private buildCliMissingError(session: AgentSession): HeterogeneousAgentSessionError | undefined {
    switch (session.agentType) {
      case 'claude-code': {
        return this.buildClaudeCodeCliMissingError(session);
      }
      case 'codex': {
        return this.buildCodexCliMissingError(session);
      }
      default: {
        return;
      }
    }
  }

  private buildCliAuthRequiredError(
    session: AgentSession,
    stderr: string,
  ): HeterogeneousAgentSessionError | undefined {
    const command = this.resolveSessionCommand(session);

    switch (session.agentType) {
      case 'claude-code': {
        return {
          agentType: 'claude-code',
          code: HeterogeneousAgentSessionErrorCode.AuthRequired,
          command,
          docsUrl: CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
          message:
            'Claude Code could not authenticate. Sign in again or refresh its credentials, then retry.',
          stderr,
        };
      }
      case 'codex': {
        return {
          agentType: 'codex',
          code: HeterogeneousAgentSessionErrorCode.AuthRequired,
          command,
          docsUrl: CODEX_CLI_INSTALL_DOCS_URL,
          message:
            'Codex could not authenticate. Sign in again or refresh its credentials, then retry.',
          stderr,
        };
      }
      default: {
        return;
      }
    }
  }

  private getErrorMessage(error: unknown): string | undefined {
    return typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' &&
            error &&
            'message' in error &&
            typeof error.message === 'string'
          ? error.message
          : undefined;
  }

  private buildCodexResumeError(
    code:
      | typeof HeterogeneousAgentSessionErrorCode.ResumeCwdMismatch
      | typeof HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
    stderr: string,
    session: AgentSession,
  ): HeterogeneousAgentSessionError {
    const message =
      code === HeterogeneousAgentSessionErrorCode.ResumeCwdMismatch
        ? 'The saved Codex thread can only be resumed from its original working directory.'
        : 'The saved Codex thread could not be found, so it can no longer be resumed.';

    return {
      agentType: 'codex',
      code,
      command: session.command,
      message,
      resumeSessionId: session.resumeSessionId,
      stderr,
      workingDirectory: session.cwd,
    };
  }

  private getCodexResumeError(
    error: unknown,
    session: AgentSession,
  ): HeterogeneousAgentSessionError | undefined {
    if (session.agentType !== 'codex' || !session.resumeSessionId) return;

    const message = this.getErrorMessage(error);

    if (!message) return;

    if (CODEX_RESUME_CWD_MISMATCH_PATTERNS.some((pattern) => pattern.test(message))) {
      return this.buildCodexResumeError(
        HeterogeneousAgentSessionErrorCode.ResumeCwdMismatch,
        message,
        session,
      );
    }

    if (CODEX_RESUME_THREAD_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(message))) {
      return this.buildCodexResumeError(
        HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
        message,
        session,
      );
    }
  }

  private getCliAuthRequiredError(
    error: unknown,
    session: AgentSession,
  ): HeterogeneousAgentSessionError | undefined {
    const message = this.getErrorMessage(error);

    if (!message || !CLI_AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(message))) return;

    return this.buildCliAuthRequiredError(session, message);
  }

  private getSessionErrorPayload(error: unknown, session: AgentSession): SessionErrorPayload {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
      const cliMissingError = this.buildCliMissingError(session);
      if (cliMissingError) return cliMissingError;
    }

    const resumeError = this.getCodexResumeError(error, session);
    if (resumeError) return resumeError;

    const authRequiredError = this.getCliAuthRequiredError(error, session);
    if (authRequiredError) return authRequiredError;

    return error instanceof Error ? error.message : String(error);
  }

  private async getSpawnPreflightError(
    session: AgentSession,
  ): Promise<HeterogeneousAgentSessionError | undefined> {
    const defaultCommand =
      session.agentType === 'claude-code'
        ? 'claude'
        : session.agentType === 'codex'
          ? 'codex'
          : undefined;
    if (!defaultCommand) return;

    const command = this.resolveSessionCommand(session);
    const status =
      command === defaultCommand
        ? await this.app.toolDetectorManager?.detect?.(defaultCommand, true)
        : await detectHeterogeneousCliCommand(
            session.agentType === 'claude-code' ? 'claude-code' : 'codex',
            command,
          );
    const cliMissingError = this.buildCliMissingError(session);

    if (!status || status.available || !cliMissingError) return;

    return cliMissingError;
  }

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
    return path.join(this.app.appStoragePath, FILE_CACHE_DIR);
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
    image: HeterogeneousAgentImageAttachment,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const cacheDir = this.fileCacheDir;
    const cacheKey = this.getImageCacheKey(image.id);
    const metaPath = path.join(cacheDir, `${cacheKey}.meta`);
    const dataPath = path.join(cacheDir, cacheKey);

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

  private guessImageExtension(
    mimeType: string,
    image: HeterogeneousAgentImageAttachment,
  ): string | undefined {
    const knownByMime: Record<string, string> = {
      'image/gif': '.gif',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };

    if (knownByMime[mimeType]) return knownByMime[mimeType];

    try {
      const pathname = new URL(image.url).pathname;
      const ext = path.extname(pathname);
      return ext || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Materialize an image attachment into a stable local file path so CLIs like
   * Codex can consume it through `--image <file>`.
   */
  private async resolveCliImagePath(image: HeterogeneousAgentImageAttachment): Promise<string> {
    const { buffer, mimeType } = await this.resolveImage(image);
    const cacheKey = this.getImageCacheKey(image.id);
    const ext = this.guessImageExtension(mimeType, image) || '';
    const filePath = path.join(this.fileCacheDir, `${cacheKey}${ext}`);

    try {
      await access(filePath);
    } catch {
      await mkdir(this.fileCacheDir, { recursive: true });
      await writeFile(filePath, buffer);
    }

    return filePath;
  }

  private async resolveCliImagePaths(
    imageList: HeterogeneousAgentImageAttachment[] = [],
  ): Promise<string[]> {
    const resolved = await Promise.all(
      imageList.map(async (image) => {
        try {
          return await this.resolveCliImagePath(image);
        } catch (err) {
          logger.error(`Failed to materialize image ${image.id} for CLI:`, err);
          return undefined;
        }
      }),
    );

    return resolved.filter(Boolean) as string[];
  }

  /**
   * Build a stream-json user message with text + optional image content blocks.
   */
  private async buildStreamJsonInput(
    prompt: string,
    imageList: HeterogeneousAgentImageAttachment[] = [],
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

    return `${JSON.stringify({
      message: { content, role: 'user' },
      type: 'user',
    })}\n`;
  }

  // ─── IPC methods ───

  /**
   * Create a session (stores config, process spawned on sendPrompt).
   */
  @IpcMethod()
  async startSession(params: StartSessionParams): Promise<StartSessionResult> {
    const sessionId = randomUUID();
    const agentType = params.agentType || 'claude-code';
    getHeterogeneousAgentDriver(agentType);

    this.sessions.set(sessionId, {
      // If resuming, pre-set the agent session ID so sendPrompt adds --resume
      agentSessionId: params.resumeSessionId,
      agentType,
      args: params.args || [],
      command: params.command,
      cwd: params.cwd,
      env: params.env,
      sessionId,
      resumeSessionId: params.resumeSessionId,
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

    const preflightError = await this.getSpawnPreflightError(session);
    if (preflightError) {
      this.broadcast('heteroAgentSessionError', {
        error: preflightError,
        sessionId: session.sessionId,
      });
      throw new Error(preflightError.message);
    }

    const driver = getHeterogeneousAgentDriver(session.agentType);
    const spawnPlan = await driver.buildSpawnPlan({
      args: session.args,
      helpers: {
        buildClaudeStreamJsonInput: (prompt, imageList) =>
          this.buildStreamJsonInput(prompt, imageList),
        resolveCliImagePaths: (imageList) => this.resolveCliImagePaths(imageList),
      },
      imageList: params.imageList ?? [],
      prompt: params.prompt,
      resumeSessionId: session.agentSessionId,
    });
    const useStdin = spawnPlan.stdinPayload !== undefined;

    return new Promise<void>((resolve, reject) => {
      const cliArgs = spawnPlan.args;

      // Fall back to the user's Desktop so the process never inherits
      // the Electron parent's cwd (which is `/` when launched from Finder).
      const cwd = session.cwd || electronApp.getPath('desktop');

      logger.info('Spawning agent:', session.command, cliArgs.join(' '), `(cwd: ${cwd})`);

      // `detached: true` on Unix puts the child in a new process group so we
      // can SIGINT/SIGKILL the whole tree (claude + any tool subprocesses)
      // via `process.kill(-pid, sig)` on cancel. Without this, SIGINT to just
      // the claude binary can leave bash/grep/etc. tool children running and
      // the CLI hung waiting on them. Windows has different semantics — use
      // taskkill /T /F there; no detached flag needed.
      // Forward the user's proxy settings to the CLI. The main-process undici
      // dispatcher doesn't reach child processes — they need env vars.
      const proxyEnv = buildProxyEnv(this.app.storeManager.get('networkProxy'));

      const proc = spawn(session.command, cliArgs, {
        cwd,
        detached: process.platform !== 'win32',
        env: { ...process.env, ...proxyEnv, ...session.env },
        stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });

      // In stdin mode, write the prepared payload and close stdin.
      if (useStdin && spawnPlan.stdinPayload !== undefined && proc.stdin) {
        const stdin = proc.stdin as Writable;
        stdin.write(spawnPlan.stdinPayload, () => {
          stdin.end();
        });
      }

      session.process = proc;
      const streamProcessor = driver.createStreamProcessor();
      const codexFileChangeTracker =
        session.agentType === 'codex' ? new CodexFileChangeTracker() : undefined;
      let stdoutBroadcastQueue: Promise<void> = Promise.resolve();

      const broadcastParsedOutputs = (parsedOutputs: HeterogeneousAgentParsedOutput[]) => {
        stdoutBroadcastQueue = stdoutBroadcastQueue
          .then(async () => {
            for (const parsedOutput of parsedOutputs) {
              if (parsedOutput.agentSessionId) {
                session.agentSessionId = parsedOutput.agentSessionId;
              }

              const line = codexFileChangeTracker
                ? await codexFileChangeTracker.track(parsedOutput.payload)
                : parsedOutput.payload;

              this.broadcast('heteroAgentRawLine', {
                line,
                sessionId: session.sessionId,
              });
            }
          })
          .catch((error) => {
            logger.error('Failed to broadcast parsed agent output:', error);
          });
      };

      // Stream stdout events as raw provider payloads to Renderer.
      const stdout = proc.stdout as Readable;
      stdout.on('data', (chunk: Buffer) => {
        broadcastParsedOutputs(streamProcessor.push(chunk));
      });
      stdout.on('end', () => {
        broadcastParsedOutputs(streamProcessor.flush());
      });

      // Capture stderr
      const stderrChunks: string[] = [];
      const stderr = proc.stderr as Readable;
      stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString('utf8'));
      });

      proc.on('error', (err) => {
        logger.error('Agent process error:', err);
        const sessionError = this.getSessionErrorPayload(err, session);
        this.broadcast('heteroAgentSessionError', {
          error: sessionError,
          sessionId: session.sessionId,
        });
        reject(new Error(typeof sessionError === 'string' ? sessionError : sessionError.message));
      });

      proc.on('exit', (code, signal) => {
        void stdoutBroadcastQueue.finally(() => {
          logger.info('Agent process exited:', { code, sessionId: session.sessionId, signal });
          session.process = undefined;

          // If *we* killed it (cancel / stop / before-quit), treat the non-zero
          // exit as a clean shutdown — surfacing it as an error would make a
          // user-initiated cancel look like an agent failure, and an Electron
          // shutdown affecting OTHER running CC sessions would pollute their
          // topics with a misleading "Agent exited with code 143" message.
          if (session.cancelledByUs) {
            this.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
            resolve();
            return;
          }

          if (code === 0) {
            this.broadcast('heteroAgentSessionComplete', { sessionId: session.sessionId });
            resolve();
          } else {
            const stderrOutput = stderrChunks.join('').trim();
            const errorMsg = stderrOutput || `Agent exited with code ${code}`;
            const sessionError = this.getSessionErrorPayload(errorMsg, session);
            this.broadcast('heteroAgentSessionError', {
              error: sessionError,
              sessionId: session.sessionId,
            });
            reject(
              new Error(typeof sessionError === 'string' ? sessionError : sessionError.message),
            );
          }
        });
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
   * Signal the whole process tree spawned by this session.
   *
   * On Unix the child was spawned with `detached: true`, so negating the pid
   * signals the process group — reaching tool subprocesses (bash, grep, etc.)
   * that would otherwise orphan after a parent-only kill. Falls back to the
   * direct signal if the group kill raises (ESRCH when the leader is already
   * gone). On Windows we shell out to `taskkill /T /F` which walks the tree.
   */
  private killProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
    if (!proc.pid || proc.killed) return;

    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch (err) {
        logger.warn('taskkill failed:', err);
      }
      return;
    }

    try {
      process.kill(-proc.pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {
        // already exited
      }
    }
  }

  /**
   * Cancel an ongoing session: SIGINT the CC tree, escalate to SIGKILL after
   * 2s if the CLI hasn't exited (some tool calls swallow SIGINT). The
   * `exit` handler on the spawned proc broadcasts completion and clears
   * `session.process`, so the escalation is a no-op when the graceful path
   * already landed.
   */
  @IpcMethod()
  async cancelSession(params: CancelSessionParams): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session?.process || session.process.killed) return;

    session.cancelledByUs = true;
    const proc = session.process;
    this.killProcessTree(proc, 'SIGINT');

    setTimeout(() => {
      if (session.process === proc && !proc.killed) {
        logger.warn('Session did not exit after SIGINT, escalating to SIGKILL:', params.sessionId);
        this.killProcessTree(proc, 'SIGKILL');
      }
    }, 2000);
  }

  /**
   * Stop and clean up a session.
   */
  @IpcMethod()
  async stopSession(params: StopSessionParams): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) return;

    if (session.process && !session.process.killed) {
      session.cancelledByUs = true;
      const proc = session.process;
      this.killProcessTree(proc, 'SIGTERM');
      setTimeout(() => {
        if (session.process === proc && !proc.killed) {
          this.killProcessTree(proc, 'SIGKILL');
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
          session.cancelledByUs = true;
          this.killProcessTree(session.process, 'SIGTERM');
        }
      }
      this.sessions.clear();
    });
  }
}
