import {
  type CallToolRequestParams,
  Client,
  type ElicitRequestParams,
  type ElicitResult,
  isInputRequiredResult,
  ProtocolError,
  type RequestOptions,
  SdkError,
  SdkErrorCode,
  specTypeSchemas,
  withInputRequired,
} from '@modelcontextprotocol/client';

import { validateMcpElicitationRequest, validateMcpElicitationResponse } from './form';
import type { McpElicitationContinuation, McpElicitationHost } from './types';
import { McpCallNotStartedError, McpInputRequiredError } from './types';

export type {
  McpElicitationCheckpoint,
  McpElicitationContinuation,
  McpElicitationHost,
} from './types';
export { McpCallNotStartedError, McpInputRequiredError } from './types';

/** The standalone SDK request schema is legacy; modern URL omits elicitationId. */
export async function parseMcpElicitationRequest(
  value: unknown,
  modern: boolean,
): Promise<ElicitRequestParams> {
  let request: ElicitRequestParams;
  if (modern) {
    const parsed = await withInputRequired(specTypeSchemas.CallToolResult)['~standard'].validate({
      resultType: 'input_required',
      inputRequests: { input: { method: 'elicitation/create', params: value } },
    });
    if (!('value' in parsed) || !isInputRequiredResult(parsed.value))
      throw new Error('Invalid modern MCP elicitation request');
    request = parsed.value.inputRequests!.input.params as ElicitRequestParams;
  } else {
    const parsed = await specTypeSchemas.ElicitRequestParams['~standard'].validate(value);
    if (!('value' in parsed)) throw new Error('Invalid legacy MCP elicitation request');
    request = parsed.value;
  }
  validateMcpElicitationRequest(request);
  return request;
}

/** Preserve SDK callTool header mirroring and output validation while parking the
 * decoded non-complete result before the SDK reduces it to an error code.
 * This is the SDK's protected response-funnel extension point; no auto-fulfilment.
 */
export class McpProtocolClient extends Client {
  protected override async _resolveNonCompleteResult(decoded: {
    kind: 'input_required';
    inputRequests: Record<string, unknown>;
    requestState?: string;
  }) {
    const parsed = await withInputRequired(specTypeSchemas.CallToolResult)['~standard'].validate({
      ...decoded,
      resultType: 'input_required',
    });
    if (!('value' in parsed) || !isInputRequiredResult(parsed.value))
      throw new Error('Invalid MCP input_required result');
    throw new McpInputRequiredError({ inputRequired: parsed.value, round: 0 });
  }
}

/** A host cannot extend the invocation deadline, including an already-aborted signal. */
async function requestInput(
  host: McpElicitationHost,
  request: ElicitRequestParams,
  context: Parameters<McpElicitationHost['request']>[1],
) {
  context.signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(context.signal.reason);
    context.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([host.request(request, context), aborted]);
  } finally {
    context.signal.removeEventListener('abort', onAbort);
  }
}

/** A host belongs to ONE invocation. Legacy sessions serialize invocations because old peers lack correlation. */
export class McpElicitationClient {
  private tail: Promise<void> = Promise.resolve();
  private activeHost?: McpElicitationHost;
  private activeSignal?: AbortSignal;
  private retired = false;
  private activeCalls = 0;
  private closePromise?: Promise<void>;
  private interactionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: Client,
    private readonly enabled = false,
    private readonly retire?: () => Promise<void>,
  ) {
    if (!enabled) return;
    client.registerCapabilities({ elicitation: { form: {}, url: {} } });
    client.setRequestHandler('elicitation/create', async (request, context) => {
      const host = this.activeHost;
      if (!host) throw new Error('MCP elicitation has no active user tool call');
      const signal = this.activeSignal
        ? AbortSignal.any([context.mcpReq.signal, this.activeSignal])
        : context.mcpReq.signal;
      const previous = this.interactionTail;
      let release!: () => void;
      this.interactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (signal.aborted) return { action: 'cancel' as const };
        validateMcpElicitationRequest(request.params);
        const result = await requestInput(host, request.params, { signal });
        const errors = validateMcpElicitationResponse(request.params, result);
        if (errors.length) throw new Error(errors.join('\n'));
        return result;
      } finally {
        release();
      }
    });
  }

  /** Retiring a hosted call must not tear down other valid calls already on this session. */
  async closeWhenIdle() {
    this.retired = true;
    if (this.activeCalls > 0) return;
    this.closePromise ??= this.retire ? this.retire() : this.client.close();
    await this.closePromise;
  }

  async callToolInteractively(
    params: CallToolRequestParams,
    options: RequestOptions,
    host: McpElicitationHost,
  ) {
    const deadline = Date.now() + (options.timeout ?? 60_000);
    options = {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout ?? 60_000)])
        : AbortSignal.timeout(options.timeout ?? 60_000),
    };
    let continuation: McpElicitationContinuation | undefined;
    for (;;) {
      try {
        return await this.callTool(
          params,
          { ...options, timeout: Math.max(1, deadline - Date.now()) },
          host,
          continuation,
        );
      } catch (error) {
        if (!(error instanceof McpInputRequiredError)) throw error;
        const requests = Object.entries(error.checkpoint.inputRequired.inputRequests ?? {});
        const inputResponses: Record<string, ElicitResult> = Object.create(null);
        const signal = options.signal ?? AbortSignal.timeout(options.timeout ?? 60_000);
        if (
          requests.length === 0 &&
          (
            await requestInput(
              host,
              {
                mode: 'form',
                message: 'The MCP server is waiting. Continue the original operation?',
                requestedSchema: { type: 'object', properties: {} },
              },
              { signal, checkpoint: error.checkpoint },
            )
          ).action !== 'accept'
        )
          return {
            content: [
              { type: 'text' as const, text: 'The user cancelled the pending MCP operation.' },
            ],
            isError: true,
          };
        for (const [id, request] of requests) {
          const params = request.params as ElicitRequestParams;
          const response = await requestInput(host, params, {
            signal,
            checkpoint: error.checkpoint,
          });
          const errors = validateMcpElicitationResponse(params, response);
          if (errors.length) throw new Error(errors.join('\n'), { cause: error });
          inputResponses[id] = response;
        }
        if (
          error.checkpoint.legacyUrl &&
          Object.values(inputResponses).some((response) => response.action !== 'accept')
        )
          return {
            content: [
              { type: 'text' as const, text: 'The user cancelled the external MCP interaction.' },
            ],
            isError: true,
          };
        continuation = { ...error.checkpoint, inputResponses };
      }
    }
  }

  async callTool(
    params: CallToolRequestParams,
    options: RequestOptions,
    host?: McpElicitationHost,
    continuation?: McpElicitationContinuation,
  ) {
    if (host && !this.enabled)
      throw new McpCallNotStartedError(
        false,
        new Error('This MCP connection has no elicitation host capability'),
      );
    const signal = host
      ? AbortSignal.any([
          ...(options.signal ? [options.signal] : []),
          AbortSignal.timeout(options.timeout ?? 60_000),
        ])
      : options.signal;
    options = { ...options, signal };
    const run = async () => {
      if (signal?.aborted) throw new McpCallNotStartedError(false, signal.reason);
      if (this.retired) throw new McpCallNotStartedError();
      this.activeCalls++;
      if (host) {
        this.activeHost = host;
        this.activeSignal = signal;
      }
      try {
        const callParams = {
          ...params,
          ...(continuation &&
            !continuation.legacyUrl && {
              inputResponses: continuation.inputResponses,
              ...(continuation.inputRequired.requestState !== undefined && {
                requestState: continuation.inputRequired.requestState,
              }),
            }),
        };
        let result;
        try {
          result = await this.client.callTool(callParams, options);
        } catch (error) {
          if (error instanceof McpInputRequiredError) {
            result = error.checkpoint.inputRequired;
          } else if (ProtocolError.isInstance(error) && error.code === -32042 && host) {
            const parsed = await specTypeSchemas.ElicitRequestURLParams['~standard'].validate(
              (error.data as { elicitations?: unknown[] })?.elicitations?.[0],
            );
            if (parsed.issues) throw error;
            const elicitations = (error.data as { elicitations: ElicitRequestParams[] })
              .elicitations;
            if ((continuation?.round ?? 0) >= 10)
              throw new Error('MCP elicitation exceeded 10 rounds', { cause: error });
            for (const request of elicitations) validateMcpElicitationRequest(request);
            throw new McpInputRequiredError({
              inputRequired: {
                resultType: 'input_required',
                inputRequests: Object.fromEntries(
                  elicitations.map((params, index) => [
                    `url_${index}`,
                    { method: 'elicitation/create' as const, params },
                  ]),
                ),
              },
              legacyUrl: true,
              round: (continuation?.round ?? 0) + 1,
            });
          } else throw error;
        }
        if (isInputRequiredResult(result)) {
          const round = (continuation?.round ?? 0) + 1;
          if (round > 10) throw new Error('MCP elicitation exceeded 10 rounds');
          for (const request of Object.values(result.inputRequests ?? {})) {
            if (request.method !== 'elicitation/create')
              throw new Error(`Unsupported MCP input request: ${request.method}`);
            validateMcpElicitationRequest(request.params as ElicitRequestParams);
          }
          throw new McpInputRequiredError({ inputRequired: result, round });
        }
        return result;
      } catch (error) {
        if (
          host &&
          this.client.getProtocolEra() !== 'modern' &&
          (options.signal?.aborted ||
            (SdkError.isInstance(error) &&
              [SdkErrorCode.RequestTimeout, SdkErrorCode.ConnectionClosed].includes(error.code)))
        ) {
          this.retired = true;
        }
        throw error;
      } finally {
        if (host && this.activeHost === host) {
          this.activeHost = undefined;
          this.activeSignal = undefined;
        }
        this.activeCalls--;
        if (this.retired && this.activeCalls === 0) await this.closeWhenIdle();
      }
    };
    if (!host || this.client.getProtocolEra() === 'modern') return run();
    const previous = this.tail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => gate);
    let onAbort: (() => void) | undefined;
    try {
      if (signal?.aborted) throw new McpCallNotStartedError(false, signal.reason);
      await Promise.race([
        previous,
        new Promise<never>((_resolve, reject) => {
          if (!signal) return;
          onAbort = () => reject(new McpCallNotStartedError(false, signal.reason));
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
      return await run();
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      release();
    }
  }
}
