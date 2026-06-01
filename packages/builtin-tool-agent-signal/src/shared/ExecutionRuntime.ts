import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { AGENT_SIGNAL_TOOL_RESULT_KIND, type AgentSignalToolApiName } from './apiNames';

/** Tool result discriminator (LOBE-9434 #5). */
export type ToolResultKind = 'artifact' | 'mutation' | 'read';

/**
 * Per-call context handed to a self-iteration tool. Mirrors the subset of the
 * server `ToolExecutionContext` the tools actually need; the concrete service
 * (wired in the server runtime factory) owns db / charge / receipt access.
 */
export interface AgentSignalToolContext {
  agentId?: string;
  operationId?: string;
  toolCallId?: string;
  topicId?: string;
  userId?: string;
}

export interface AgentSignalToolInvocationResult {
  /** Structured tool payload. Object results are spread into the result state. */
  data?: unknown;
  error?: { message: string };
  /** Defaults to `!error`. */
  success?: boolean;
}

/**
 * Service boundary the ExecutionRuntime delegates to. The server runtime factory
 * implements `invoke` by routing each api name to the existing self-iteration
 * `createToolSet(adapters)` surface; this keeps the package free of server deps.
 */
export interface AgentSignalToolService {
  invoke: (
    apiName: AgentSignalToolApiName,
    input: Record<string, unknown>,
    context: AgentSignalToolContext,
  ) => Promise<AgentSignalToolInvocationResult>;
}

export interface AgentSignalToolExecutionRuntimeOptions {
  /** Api names this runtime exposes (the mode's tool surface). */
  apiNames: readonly AgentSignalToolApiName[];
  service: AgentSignalToolService;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Shared server-side runtime for the three self-iteration tool packages.
 *
 * Builds one bound method per api name (the `BuiltinToolsExecutor` dispatches by
 * `runtime[apiName](args, context)`), delegates to the injected service, and
 * stamps every result with its `kind` so `extractFromFinalState` can reconstruct
 * read / artifact / mutation outcomes from a persisted snapshot.
 */
export class AgentSignalToolExecutionRuntime {
  [apiName: string]: unknown;

  private readonly service: AgentSignalToolService;

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
      const result = await this.service.invoke(apiName, input, context);
      const data = isRecord(result.data) ? result.data : { value: result.data };
      const state = { kind, ...data };
      const success = result.success ?? !result.error;

      return {
        content: JSON.stringify(state),
        state,
        success,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown agent-signal tool error';

      return {
        content: `${apiName} failed: ${message}`,
        error: { message },
        state: { kind },
        success: false,
      };
    }
  };
}
