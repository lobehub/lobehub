import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { AGENT_SIGNAL_TOOL_RESULT_KIND, type AgentSignalToolApiName } from './apiNames';

/** Tool result discriminator. */
export type ToolResultKind = 'artifact' | 'mutation' | 'read';

/**
 * Per-call context handed to a self-iteration tool. Mirrors the subset of the
 * server `ToolExecutionContext` the primitives actually need; the concrete
 * primitive (wired in the server runtime factory) owns db / model access.
 */
export interface AgentSignalToolContext {
  agentId?: string;
  operationId?: string;
  toolCallId?: string;
  topicId?: string;
  userId?: string;
}

/**
 * A single DB-backed primitive for one api name. Resolves the live read or
 * applies the durable write, then returns a plain payload — the runtime stamps
 * the `kind` discriminator and serializes the tool result. Throw to surface a
 * failure; return a `{ status: 'skipped_*' }` payload to surface a safe no-op.
 */
export type AgentSignalRuntimePrimitive = (
  input: Record<string, unknown>,
  context: AgentSignalToolContext,
) => Promise<unknown>;

/**
 * Narrow DB seam the ExecutionRuntime delegates to — one named primitive per
 * read / mutation api name. The server runtime factory builds this from the
 * tool execution context (db / userId / agentId), so the package stays free of
 * server deps.
 *
 * Artifact recorders (`recordSelfReviewIdea` / `recordReflectionIdea` /
 * `recordSelfFeedbackIntent`) are intentionally absent: they have no durable
 * side effect, so the runtime echoes their input instead of calling a primitive.
 * Each mode implements only the subset of primitives it advertises.
 */
export type AgentSignalRuntimeService = Partial<
  Record<AgentSignalToolApiName, AgentSignalRuntimePrimitive>
>;

export interface AgentSignalToolExecutionRuntimeOptions {
  /** Api names this runtime exposes (the mode's tool surface). */
  apiNames: readonly AgentSignalToolApiName[];
  service: AgentSignalRuntimeService;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Shared server-side runtime for the three self-iteration tool packages.
 *
 * Builds one bound method per api name (the `BuiltinToolsExecutor` dispatches by
 * `runtime[apiName](args, context)`), routes reads / mutations to the injected
 * primitive, echoes artifact recorders, and stamps every result with its `kind`
 * so `extractFromFinalState` can reconstruct read / artifact / mutation outcomes
 * from a persisted snapshot.
 *
 * Note: the runtime carries no dedupe / receipt / operation-state side channel —
 * tools just read or mutate the DB. Idempotency and receipt projection live on
 * the execAgent completion path, not inside the tool call.
 */
export class AgentSignalToolExecutionRuntime {
  [apiName: string]: unknown;

  private readonly service: AgentSignalRuntimeService;

  constructor(options: AgentSignalToolExecutionRuntimeOptions) {
    this.service = options.service;

    for (const apiName of options.apiNames) {
      this[apiName] = (input: Record<string, unknown>, context: AgentSignalToolContext) =>
        this.run(apiName, input ?? {}, context ?? {});
    }
  }

  private run = async (
    apiName: AgentSignalToolApiName,
    input: Record<string, unknown>,
    context: AgentSignalToolContext,
  ): Promise<BuiltinServerRuntimeOutput> => {
    const kind = AGENT_SIGNAL_TOOL_RESULT_KIND[apiName];

    try {
      const raw = kind === 'artifact' ? input : await this.invokePrimitive(apiName, input, context);
      const data = isRecord(raw) ? raw : { value: raw };
      // Stamp both `apiName` and `kind` into the persisted result content. The
      // agent runtime only persists tool messages with content/role/tool_call_id
      // (no message-level apiName), so the completion-path extractor must recover
      // apiName from the content — same channel as `kind`.
      const state = { apiName, kind, ...data };

      return {
        content: JSON.stringify(state),
        state,
        success: true,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown agent-signal tool error';

      return {
        content: `${apiName} failed: ${message}`,
        error: { message },
        state: { apiName, kind },
        success: false,
      };
    }
  };

  private invokePrimitive = async (
    apiName: AgentSignalToolApiName,
    input: Record<string, unknown>,
    context: AgentSignalToolContext,
  ): Promise<unknown> => {
    const primitive = this.service[apiName];
    if (!primitive) throw new Error(`Unsupported agent-signal tool: ${apiName}`);

    return primitive(input, context);
  };
}
