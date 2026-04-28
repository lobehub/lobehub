import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import { createLogger } from '@/utils/logger';

import type {
  ACPInitializeParams,
  ACPPermissionRequest,
  ACPPermissionResponse,
  ACPServerCapabilities,
  ACPSessionCancelParams,
  ACPSessionInfo,
  ACPSessionNewParams,
  ACPSessionPromptParams,
  ACPSessionUpdate,
  FSReadTextFileParams,
  FSReadTextFileResult,
  FSWriteTextFileParams,
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  TerminalCreateParams,
  TerminalCreateResult,
  TerminalKillParams,
  TerminalOutputParams,
  TerminalOutputResult,
  TerminalReleaseParams,
  TerminalWaitForExitParams,
  TerminalWaitForExitResult,
} from './types';

const logger = createLogger('libs:acp:client');

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
};

export interface ACPClientParams {
  args?: string[];
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ACPClientCallbacks {
  onPermissionRequest?: (request: ACPPermissionRequest) => Promise<ACPPermissionResponse>;
  onSessionComplete?: (sessionId: string) => void;
  onSessionUpdate?: (update: ACPSessionUpdate) => void;
}

/**
 * ACP Client that communicates with an ACP agent (e.g. Claude Code) over stdio JSON-RPC 2.0.
 *
 * Bidirectional: sends requests to agent AND handles incoming requests from agent
 * (fs/read_text_file, fs/write_text_file, terminal/*, session/request_permission).
 */
export class ACPClient {
  private buffer = '';
  private callbacks: ACPClientCallbacks = {};
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private process: ChildProcess | null = null;
  private stderrLogs: string[] = [];

  // Client-side method handlers (agent calls these)
  private clientMethodHandlers = new Map<string, (params: any) => Promise<unknown>>();

  constructor(private readonly params: ACPClientParams) {}

  /**
   * Register handlers for client-side methods that the agent can call back.
   */
  registerClientMethods(handlers: {
    'fs/read_text_file'?: (params: FSReadTextFileParams) => Promise<FSReadTextFileResult>;
    'fs/write_text_file'?: (params: FSWriteTextFileParams) => Promise<void>;
    'terminal/create'?: (params: TerminalCreateParams) => Promise<TerminalCreateResult>;
    'terminal/kill'?: (params: TerminalKillParams) => Promise<void>;
    'terminal/output'?: (params: TerminalOutputParams) => Promise<TerminalOutputResult>;
    'terminal/release'?: (params: TerminalReleaseParams) => Promise<void>;
    'terminal/wait_for_exit'?: (
      params: TerminalWaitForExitParams,
    ) => Promise<TerminalWaitForExitResult>;
  }) {
    for (const [method, handler] of Object.entries(handlers)) {
      if (handler) {
        this.clientMethodHandlers.set(method, handler);
      }
    }
  }

  setCallbacks(callbacks: ACPClientCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Spawn the agent process and initialize the ACP connection.
   */
  async connect(): Promise<ACPServerCapabilities> {
    const { command, args = [], env, cwd } = this.params;

    this.process = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Capture stderr
    const stderr = this.process.stderr as Readable | null;
    if (stderr) {
      stderr.on('data', (chunk: Buffer) => {
        const lines = chunk
          .toString('utf8')
          .split('\n')
          .filter((l) => l.trim());
        this.stderrLogs.push(...lines);
      });
    }

    // Listen for stdout (JSON-RPC messages)
    const stdout = this.process.stdout as Readable | null;
    if (stdout) {
      stdout.on('data', (chunk: Buffer) => {
        this.handleData(chunk.toString('utf8'));
      });
    }

    this.process.on('error', (err) => {
      logger.error('ACP process error:', err);
    });

    this.process.on('exit', (code, signal) => {
      logger.info('ACP process exited:', { code, signal });
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error(`ACP process exited (code=${code}, signal=${signal})`));
        this.pendingRequests.delete(id);
      }
    });

    // Initialize
    const capabilities = await this.initialize();
    return capabilities;
  }

  /**
   * Send initialize request to the agent.
   */
  private async initialize(): Promise<ACPServerCapabilities> {
    const params: ACPInitializeParams = {
      capabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: 'lobehub-desktop', version: '1.0.0' },
      protocolVersion: '0.1',
    };

    return this.sendRequest<ACPServerCapabilities>('initialize', params);
  }

  /**
   * Create a new session.
   */
  async createSession(params?: ACPSessionNewParams): Promise<ACPSessionInfo> {
    return this.sendRequest<ACPSessionInfo>('session/new', params);
  }

  /**
   * Send a prompt to an existing session.
   */
  async sendPrompt(params: ACPSessionPromptParams): Promise<void> {
    return this.sendRequest<void>('session/prompt', params);
  }

  /**
   * Cancel an ongoing session operation.
   */
  async cancelSession(params: ACPSessionCancelParams): Promise<void> {
    return this.sendRequest<void>('session/cancel', params);
  }

  /**
   * Respond to a permission request from the agent.
   */
  respondToPermission(requestId: string, response: ACPPermissionResponse): void {
    this.sendResponse(requestId, response);
  }

  /**
   * Disconnect from the agent and kill the process.
   */
  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');

      // Force kill after timeout
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.process?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.process = null;
    }
  }

  getStderrLogs(): string[] {
    return this.stderrLogs;
  }

  // ============================================================
  // JSON-RPC transport layer
  // ============================================================

  private sendRequest<T>(method: string, params?: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: JsonRpcRequest = {
        id,
        jsonrpc: '2.0',
        method,
        params,
      };

      this.pendingRequests.set(id, {
        reject,
        resolve: resolve as (result: unknown) => void,
      });

      this.writeMessage(request);
    });
  }

  private sendResponse(id: number | string, result: unknown): void {
    const response: JsonRpcResponse = {
      id,
      jsonrpc: '2.0',
      result,
    };
    this.writeMessage(response);
  }

  private sendErrorResponse(id: number | string, error: JsonRpcError): void {
    const response: JsonRpcResponse = {
      error,
      id,
      jsonrpc: '2.0',
    };
    this.writeMessage(response);
  }

  private writeMessage(message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): void {
    if (!this.process?.stdin?.writable) {
      logger.error('Cannot write to ACP process: stdin not writable');
      return;
    }

    const json = JSON.stringify(message);
    const content = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    this.process.stdin.write(content);
  }

  /**
   * Handle incoming data from stdout, parsing JSON-RPC messages.
   * Uses Content-Length header framing (LSP-style).
   */
  private handleData(data: string): void {
    this.buffer += data;

    while (true) {
      // Try to parse a complete message from the buffer
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);

      if (!contentLengthMatch) {
        // Try parsing as raw JSON (some agents don't use Content-Length headers)
        const newlineIdx = this.buffer.indexOf('\n');
        if (newlineIdx === -1) break;

        const line = this.buffer.slice(0, newlineIdx).trim();
        this.buffer = this.buffer.slice(newlineIdx + 1);

        if (line) {
          try {
            const message = JSON.parse(line);
            this.handleMessage(message);
          } catch {
            // Not valid JSON, skip
          }
        }
        continue;
      }

      const contentLength = Number.parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4; // after \r\n\r\n
      const messageEnd = messageStart + contentLength;

      if (Buffer.byteLength(this.buffer.slice(messageStart)) < contentLength) {
        // Not enough data yet
        break;
      }

      const messageStr = this.buffer.slice(messageStart, messageEnd);
      this.buffer = this.buffer.slice(messageEnd);

      try {
        const message = JSON.parse(messageStr);
        this.handleMessage(message);
      } catch (err) {
        logger.error('Failed to parse ACP JSON-RPC message:', err);
      }
    }
  }

  /**
   * Route incoming JSON-RPC messages.
   */
  private handleMessage(message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): void {
    // Response to our request
    if ('id' in message && message.id !== null && !('method' in message)) {
      const response = message as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id!);
      if (pending) {
        this.pendingRequests.delete(response.id!);
        if (response.error) {
          pending.reject(
            new Error(`ACP error [${response.error.code}]: ${response.error.message}`),
          );
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Incoming request or notification from agent
    if ('method' in message) {
      const method = message.method;
      const params = message.params || {};

      // Notification (no id) — e.g., session/update
      if (!('id' in message) || message.id === undefined || message.id === null) {
        this.handleNotification(method, params);
        return;
      }

      // Request (has id) — agent calling client methods
      this.handleIncomingRequest(message as JsonRpcRequest);
    }
  }

  /**
   * Handle notifications from the agent (no response expected).
   */
  private handleNotification(method: string, params: Record<string, unknown> | object): void {
    switch (method) {
      case 'session/update': {
        if (this.callbacks.onSessionUpdate) {
          this.callbacks.onSessionUpdate(params as unknown as ACPSessionUpdate);
        }
        break;
      }
      default: {
        logger.warn('Unhandled ACP notification:', method);
      }
    }
  }

  /**
   * Handle incoming requests from the agent (response required).
   */
  private async handleIncomingRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;

    // Special handling for permission requests
    if (method === 'session/request_permission') {
      if (this.callbacks.onPermissionRequest) {
        try {
          const response = await this.callbacks.onPermissionRequest(
            params as unknown as ACPPermissionRequest,
          );
          this.sendResponse(id, response);
        } catch (err) {
          this.sendErrorResponse(id, {
            code: -32000,
            message: err instanceof Error ? err.message : 'Permission request failed',
          });
        }
      } else {
        // Auto-allow if no handler
        const permReq = params as unknown as ACPPermissionRequest;
        const allowOption = permReq.options?.find((o) => o.kind === 'allow_once');
        this.sendResponse(id, {
          kind: 'selected',
          optionId: allowOption?.optionId || permReq.options?.[0]?.optionId,
        });
      }
      return;
    }

    // Delegate to registered client method handlers
    const handler = this.clientMethodHandlers.get(method);
    if (handler) {
      try {
        const result = await handler(params);
        this.sendResponse(id, result ?? null);
      } catch (err) {
        this.sendErrorResponse(id, {
          code: -32000,
          message: err instanceof Error ? err.message : 'Client method failed',
        });
      }
    } else {
      this.sendErrorResponse(id, {
        code: -32601,
        message: `Method not found: ${method}`,
      });
    }
  }
}
