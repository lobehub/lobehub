import type {
  ElicitRequestParams,
  ElicitResult,
  InputRequiredResult,
  InputResponses,
} from '@modelcontextprotocol/client';

export type McpElicitationRequest = ElicitRequestParams;
export type McpElicitationResponse = ElicitResult;

/** Private protocol checkpoint. Never serialize this into model-visible content. */
export interface McpElicitationCheckpoint {
  inputRequired: InputRequiredResult;
  legacyUrl?: boolean;
  round: number;
}

export interface McpElicitationContinuation extends McpElicitationCheckpoint {
  inputResponses: InputResponses;
}

export interface McpElicitationHost {
  /** Persist the request before waiting. The host binds ownership, call identity and deadline. */
  request: (
    request: McpElicitationRequest,
    context: { signal: AbortSignal; checkpoint?: McpElicitationCheckpoint },
  ) => Promise<McpElicitationResponse>;
}

export class McpInputRequiredError extends Error {
  constructor(readonly checkpoint: McpElicitationCheckpoint) {
    super('MCP tool is waiting for user input');
    this.name = 'McpInputRequiredError';
  }
}

export interface McpElicitationCall {
  continuation?: McpElicitationContinuation;
  deadline: number;
  /** Scoped callback ticket for a workspace device; never a general user credential. */
  delegation?: string;
  identity: {
    apiName: string;
    assistantMessageId: string;
    identifier: string;
    operationId: string;
    toolCallId: string;
    toolMessageId?: string;
  };
  /** Desktop main relays completion directly so a closed renderer cannot lose it. */
  relayResult?: boolean;
  workspaceId?: string;
}

/** The previous session ended; this queued invocation never reached the wire. */
export class McpCallNotStartedError extends Error {
  constructor(
    readonly retryable = true,
    cause?: unknown,
  ) {
    super('MCP invocation ended before this tool call started', { cause });
    this.name = 'McpCallNotStartedError';
  }
}

/** Private control response for requestState-only waits; never sent as MCP inputResponses. */
export const MCP_CONTINUATION_CONTROL = '$continuation';
