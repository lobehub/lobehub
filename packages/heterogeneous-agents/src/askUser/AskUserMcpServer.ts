import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { InterventionAnswer } from './AskUserBridge';
import { AskUserBridge } from './AskUserBridge';
import { ASK_USER_MCP_SERVER_NAME, ASK_USER_TOOL_NAME } from './constants';

/**
 * Mirrors CC's built-in `AskUserQuestion` schema. CC's schema:
 *   - 1-4 questions
 *   - each: header (≤12 chars), question, options (2-4), multiSelect?
 *   - each option: label, description
 * We replicate it so the model can call our tool with the exact shape CC
 * trained on.
 */
const askUserOptionShape = z.object({
  description: z.string(),
  label: z.string(),
});

const askUserQuestionShape = z.object({
  header: z.string(),
  multiSelect: z.boolean().optional(),
  options: z.array(askUserOptionShape).min(2).max(4),
  question: z.string(),
});

const askUserInputShape = {
  questions: z.array(askUserQuestionShape).min(1).max(4),
};

/** Tool description seen by the model. Kept terse — full schema lives in `inputSchema`. */
const ASK_USER_TOOL_DESCRIPTION =
  'Ask the user one or more clarifying questions with multiple-choice options. ' +
  "Use this whenever the user's intent is ambiguous and you need them to pick.";

export interface StartedServer {
  /** Effective listen port (auto-assigned when constructed with port=0). */
  port: number;
  /** Base URL the producer hands to CC via `--mcp-config`. */
  url: string;
}

export interface AskUserMcpServerOptions {
  /**
   * Per-call timeout passed to `bridge.pending()`. Default 5 minutes —
   * matches the issue's UX requirement and the tested CC keepalive ceiling.
   */
  pendingTimeoutMs?: number;
  /**
   * Port to bind. `0` (default) lets the OS pick a free one.
   */
  port?: number;
  /**
   * Progress notification cadence. Default 30s. CC's HTTP transport drops
   * SSE around 5min idle without a wire-level message — `notifications/progress`
   * counts as a wire-level message.
   */
  progressIntervalMs?: number;
}

interface RegisteredOperation {
  bridge: AskUserBridge;
}

interface SessionEntry {
  mcp: McpServer;
  transport: StreamableHTTPServerTransport;
}

/**
 * Process-wide MCP server that exposes a single `ask_user_question` tool to
 * CC over HTTP/SSE. One server, many concurrent operations — each spawn
 * registers a per-op `AskUserBridge` and gets back a URL with `?op=<opId>`
 * that CC's `--mcp-config` points at. Tool invocations route to the matching
 * bridge by query param.
 *
 * Lifecycle:
 *   server.start()                      // once per process
 *   bridge = server.registerOperation(opId)
 *   ...spawn CC pointing at server.url + ?op=opId...
 *   server.unregisterOperation(opId)    // releases bridge resources
 *   server.stop()                       // on app shutdown
 *
 * ## Per-session transport
 *
 * Each MCP `initialize` from a new CC subprocess gets its own
 * `StreamableHTTPServerTransport` + `McpServer` pair. The SDK's transport
 * stores `_initialized=true` and a `sessionId` per instance, so reusing a
 * single transport across sequential ops makes the second `initialize` fail
 * with `Invalid Request: Server already initialized`. Subsequent requests
 * from the same CC subprocess (carrying `mcp-session-id`) route back to the
 * matching transport via `sessionTransports` lookup.
 */
export class AskUserMcpServer {
  private httpServer?: http.Server;
  /** sessionId → transport+mcp pair. Populated on initialize, removed on session close. */
  private readonly sessionTransports = new Map<string, SessionEntry>();
  private readonly operations = new Map<string, RegisteredOperation>();
  /**
   * MCP session id → operationId. Populated when a CC initialize POST
   * arrives at `/mcp?op=<opId>`; the URL's `op` is captured via
   * `AsyncLocalStorage`, the SDK's `onsessioninitialized` hook reads it
   * at session-create time, and tool handler lookups use `extra.sessionId`.
   */
  private readonly sessionIdToOpId = new Map<string, string>();
  /** Per-request op id, populated for the duration of `handleRequest`. */
  private readonly opIdContext = new AsyncLocalStorage<string | undefined>();
  private startedUrl?: string;
  private readonly pendingTimeoutMs: number;
  private readonly progressIntervalMs: number;

  constructor(private readonly options: AskUserMcpServerOptions = {}) {
    this.pendingTimeoutMs = options.pendingTimeoutMs ?? 5 * 60 * 1000;
    this.progressIntervalMs = options.progressIntervalMs ?? 30_000;
  }

  /** URL only valid after `start()` resolves. */
  get url(): string {
    if (!this.startedUrl) {
      throw new Error('AskUserMcpServer not started yet — call start() first');
    }
    return this.startedUrl;
  }

  async start(): Promise<StartedServer> {
    if (this.httpServer) {
      // idempotent — repeat calls return the existing started state.
      return { port: (this.httpServer.address() as AddressInfo).port, url: this.url };
    }

    const httpServer = http.createServer(async (req, res) => {
      // Only the `/mcp` path is part of our contract. Anything else is
      // either a misroute or a probe — answer with 404 so it's loud.
      if (!req.url || !req.url.startsWith('/mcp')) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      // Producer encodes operationId as `?op=<opId>` on the URL it hands
      // to CC. Capture it now so `onsessioninitialized` can bind it to the
      // generated sessionId. AsyncLocalStorage keeps interleaved requests
      // from clobbering each other.
      const parsed = new URL(req.url, 'http://127.0.0.1');
      const opId = parsed.searchParams.get('op') ?? undefined;

      // The MCP transport reads from req directly. We only need to extract
      // the JSON body for POST requests so it can be passed in.
      let body: unknown;
      if (req.method === 'POST') {
        body = await readJsonBody(req).catch(() => undefined);
      }

      await this.opIdContext.run(opId, async () => {
        try {
          const transport = await this.resolveTransport(req, body);
          if (!transport) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                error: {
                  code: -32_000,
                  message: 'Bad Request: no session and no initialize request',
                },
                id: null,
                jsonrpc: '2.0',
              }),
            );
            return;
          }
          await transport.handleRequest(req, res, body);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.end(String((err as Error)?.message ?? err));
          }
        }
      });
    });

    this.httpServer = httpServer;
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(this.options.port ?? 0, '127.0.0.1', () => {
        httpServer.off('error', reject);
        resolve();
      });
    });

    const port = (httpServer.address() as AddressInfo).port;
    this.startedUrl = `http://127.0.0.1:${port}/mcp`;
    return { port, url: this.startedUrl };
  }

  async stop(): Promise<void> {
    // Close all bridges first so pending MCP handlers return quickly.
    for (const [opId] of this.operations) this.unregisterOperation(opId);
    // Tear down every per-session transport + MCP server pair.
    for (const [, entry] of this.sessionTransports) {
      await entry.transport.close().catch(() => {});
      await entry.mcp.close().catch(() => {});
    }
    this.sessionTransports.clear();
    await new Promise<void>((resolve) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.close(() => resolve());
    });
    this.httpServer = undefined;
    this.startedUrl = undefined;
  }

  /**
   * Allocate a bridge for a new operation and return the
   * `--mcp-config`-ready URL. The caller spawns CC pointing at this URL
   * and merges `bridge.events()` into the producer's outbound stream.
   */
  registerOperation(operationId: string, bridge?: AskUserBridge): AskUserBridge {
    if (this.operations.has(operationId)) {
      throw new Error(`AskUserMcpServer: operation already registered: ${operationId}`);
    }
    const created = bridge ?? new AskUserBridge(operationId);
    this.operations.set(operationId, { bridge: created });
    return created;
  }

  unregisterOperation(operationId: string): void {
    const entry = this.operations.get(operationId);
    if (!entry) return;
    entry.bridge.cancelAll('session_ended');
    this.operations.delete(operationId);
    // Drop the reverse mapping for any sessions that were bound to this op.
    for (const [sid, oid] of this.sessionIdToOpId) {
      if (oid === operationId) this.sessionIdToOpId.delete(sid);
    }
  }

  /** Build the per-op URL the producer writes into the temp `mcp-config` JSON. */
  urlForOperation(operationId: string): string {
    const base = new URL(this.url);
    base.searchParams.set('op', operationId);
    return base.toString();
  }

  /** Test/inspection helper. */
  hasOperation(operationId: string): boolean {
    return this.operations.has(operationId);
  }

  /** Currently-registered operation count. */
  get operationCount(): number {
    return this.operations.size;
  }

  /** Active MCP session count (initialize succeeded, not yet closed). */
  get sessionCount(): number {
    return this.sessionTransports.size;
  }

  /**
   * Locate (or build) the transport that should handle this request.
   *
   * - Existing session id (header) → matching stored transport
   * - No session id + initialize body → fresh transport+mcp pair, registered
   *   on `onsessioninitialized` so the very next message from this client
   *   finds its session
   * - Anything else → null (caller responds with 400)
   */
  private async resolveTransport(
    req: http.IncomingMessage,
    body: unknown,
  ): Promise<StreamableHTTPServerTransport | undefined> {
    const sessionId = (req.headers['mcp-session-id'] as string | undefined) ?? undefined;
    if (sessionId) {
      const entry = this.sessionTransports.get(sessionId);
      if (entry) return entry.transport;
      // Unknown session id — let the SDK respond 404; we still return the
      // transport-less response below.
      return undefined;
    }

    if (body && isInitializeRequest(body)) {
      return this.createSessionTransport();
    }

    return undefined;
  }

  /**
   * Build a fresh `StreamableHTTPServerTransport` + `McpServer` pair for a
   * new MCP session. The pair is registered into `sessionTransports` from
   * the `onsessioninitialized` callback, so every subsequent request
   * tagged with that sessionId routes back here without reconstruction.
   */
  private createSessionTransport(): StreamableHTTPServerTransport {
    const mcp = new McpServer(
      { name: ASK_USER_MCP_SERVER_NAME, version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    this.registerAskUserTool(mcp);

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      onsessionclosed: (sessionId: string) => {
        this.sessionTransports.delete(sessionId);
        this.sessionIdToOpId.delete(sessionId);
      },
      onsessioninitialized: (sessionId: string) => {
        this.sessionTransports.set(sessionId, { mcp, transport });
        const opId = this.opIdContext.getStore();
        if (opId) this.sessionIdToOpId.set(sessionId, opId);
      },
      sessionIdGenerator: () => randomUUID(),
    });

    // Connect synchronously so the first request's body can be processed
    // by the same transport we just built. `mcp.connect(transport)` is
    // idempotent at this stage and resolves before `handleRequest` is
    // called by the caller.
    void mcp.connect(transport);
    return transport;
  }

  private registerAskUserTool(mcp: McpServer) {
    mcp.registerTool(
      ASK_USER_TOOL_NAME,
      {
        description: ASK_USER_TOOL_DESCRIPTION,
        inputSchema: askUserInputShape,
        title: 'Ask User Question',
      },
      async (args, extra) => {
        const sessionId = (extra as { sessionId?: string } | undefined)?.sessionId;
        const operationId = sessionId ? this.sessionIdToOpId.get(sessionId) : undefined;
        if (!operationId) {
          return errorResult(
            "Missing 'op' query parameter on MCP server URL — producer should append ?op=<operationId>",
          );
        }
        const op = this.operations.get(operationId);
        if (!op) {
          return errorResult(
            `No active operation for id '${operationId}'. The op may have ended before the tool call landed.`,
          );
        }

        const ccToolUseId = (extra?._meta as { 'claudecode/toolUseId'?: string } | undefined)?.[
          'claudecode/toolUseId'
        ];
        const progressToken = (extra?._meta as { progressToken?: string | number } | undefined)
          ?.progressToken;
        // Use CC's own tool_use id as the bridge correlation key so the
        // outbound `agent_intervention_request` shares an id with the
        // existing tool message on the renderer side. Without this the
        // renderer can't tie the intervention card to its tool bubble.
        const toolCallId = ccToolUseId;

        // SSE keepalive: every progressIntervalMs send a progress
        // notification so CC's transport doesn't time out on long waits.
        // Empirically required for >~5min — we cap at 5min anyway, but
        // tick from the start so even 4-minute pendings get periodic life.
        const onProgress =
          progressToken !== undefined && extra?.sendNotification
            ? async (elapsedMs: number, totalMs: number) => {
                try {
                  await extra.sendNotification!({
                    method: 'notifications/progress',
                    params: {
                      message: `Waiting for user (${Math.round(elapsedMs / 1000)}s)`,
                      progress: elapsedMs,
                      progressToken,
                      total: totalMs,
                    },
                  });
                } catch {
                  // Non-fatal — the underlying transport may be torn down
                  // mid-flight; the next setInterval tick will skip too.
                }
              }
            : undefined;

        const answer = await op.bridge.pending(
          { arguments: args, toolCallId },
          {
            onProgress,
            progressIntervalMs: this.progressIntervalMs,
            timeoutMs: this.pendingTimeoutMs,
          },
        );

        return formatAnswerForCC(answer, args);
      },
    );
  }
}

const readJsonBody = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const errorResult = (message: string) => ({
  content: [{ text: message, type: 'text' as const }],
  isError: true,
});

const formatAnswerForCC = (answer: InterventionAnswer, args: unknown) => {
  if (answer.cancelled) {
    const reasonText =
      answer.cancelReason === 'timeout'
        ? 'No answer received within the wait window; the user did not respond. Continue without their input or ask in plain text.'
        : answer.cancelReason === 'session_ended'
          ? 'The session was ended before the user could respond.'
          : 'The user cancelled the question.';
    return {
      content: [{ text: reasonText, type: 'text' as const }],
      isError: true,
    };
  }

  // Success: format the structured answer back as text. CC's built-in
  // AskUserQuestion returns "User answers:\n- <q>: <a>" style — match it
  // so the model handles our payload identically.
  const answerObj = (answer.result ?? {}) as Record<string, unknown>;
  const questions = (args as { questions?: Array<{ question: string }> }).questions ?? [];
  const lines = ['User answers:'];
  for (const q of questions) {
    const a = answerObj[q.question];
    const formatted = Array.isArray(a) ? a.join(', ') : a == null ? '(no answer)' : String(a);
    lines.push(`- ${q.question}: ${formatted}`);
  }
  return {
    content: [{ text: lines.join('\n'), type: 'text' as const }],
  };
};
