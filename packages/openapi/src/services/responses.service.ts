import type { AgentState } from '@lobechat/agent-runtime';

import { InMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';
import type {
  StreamChunkData,
  StreamEvent,
} from '@/server/modules/AgentRuntime/StreamEventManager';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';

import { BaseService } from '../common/base.service';
import type {
  CreateResponseRequest,
  FunctionCallOutputItem,
  InputItem,
  OutputItem,
  ResponseObject,
  ResponseStreamEvent,
  ResponseUsage,
  Tool,
} from '../types/responses.type';

/**
 * Response API Service
 * Handles OpenResponses protocol request execution via AiAgentService.execAgent
 *
 * The `model` field is treated as an agent ID.
 * Execution is delegated to execAgent (background mode),
 * with executeSync used when synchronous results are needed.
 */
export class ResponsesService extends BaseService {
  /**
   * Extract hosted builtin tool identifiers from tools array
   */
  private extractHostedToolIds(tools?: Tool[] | null): string[] {
    if (!tools) return [];
    return tools.filter((t) => t.type !== 'function').map((t) => t.type);
  }

  /**
   * Extract function tool definitions from tools array
   */
  private extractFunctionTools(
    tools?: Tool[] | null,
  ): Array<{ description?: string; name: string; parameters?: Record<string, any> }> {
    if (!tools) return [];
    return tools
      .filter((t): t is Tool & { type: 'function' } => t.type === 'function')
      .map((t) => ({
        description: (t as any).description,
        name: (t as any).name,
        parameters: (t as any).parameters,
      }));
  }

  /**
   * Check if input contains function_call_output items (resume flow)
   */
  private hasFunctionCallOutputs(input: string | InputItem[]): boolean {
    if (typeof input === 'string') return false;
    return input.some((item) => item.type === 'function_call_output');
  }

  /**
   * Extract function_call_output items from input
   */
  private extractFunctionCallOutputs(input: string | InputItem[]): FunctionCallOutputItem[] {
    if (typeof input === 'string') return [];
    return input.filter(
      (item): item is FunctionCallOutputItem => item.type === 'function_call_output',
    );
  }

  /**
   * Build a prompt from function_call_output items for the resume flow.
   * Encodes tool results so the LLM can continue the conversation.
   */
  private buildToolResultPrompt(outputs: FunctionCallOutputItem[]): string {
    const parts = outputs.map((o) => `Tool call ${o.call_id} returned: ${o.output}`);
    return parts.join('\n');
  }

  /**
   * Extract a prompt string from OpenResponses input
   */
  private extractPrompt(input: string | InputItem[]): string {
    if (typeof input === 'string') return input;

    // Find the last user message
    for (let i = input.length - 1; i >= 0; i--) {
      const item = input[i];
      if (item.type === 'message' && item.role === 'user') {
        if (typeof item.content === 'string') return item.content;
        return item.content
          .map((part) => {
            if (part.type === 'input_text') return part.text;
            return '';
          })
          .filter(Boolean)
          .join('');
      }
    }

    return '';
  }

  /**
   * Extract system/developer instructions from input items
   * These are concatenated and used as additional system prompt
   */
  private extractInputInstructions(input: string | InputItem[]): string {
    if (typeof input === 'string') return '';

    const parts: string[] = [];
    for (const item of input) {
      if (item.type === 'message' && (item.role === 'system' || item.role === 'developer')) {
        if (typeof item.content === 'string') {
          parts.push(item.content);
        } else {
          const text = item.content
            .map((part) => {
              if (part.type === 'input_text') return part.text;
              return '';
            })
            .filter(Boolean)
            .join('');
          if (text) parts.push(text);
        }
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Build combined instructions from request params and input items
   */
  private buildInstructions(params: CreateResponseRequest): string | undefined {
    const inputInstructions = this.extractInputInstructions(params.input);
    const requestInstructions = params.instructions ?? '';

    const combined = [inputInstructions, requestInstructions].filter(Boolean).join('\n\n');
    return combined || undefined;
  }

  /**
   * Extract assistant content from AgentState after execution
   */
  private extractAssistantContent(state: AgentState): string {
    if (!state.messages?.length) return '';

    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg.role === 'assistant' && msg.content) {
        return typeof msg.content === 'string' ? msg.content : '';
      }
    }

    return '';
  }

  /**
   * Extract full output items from AgentState messages, including tool calls.
   * Converts assistant tool_calls → function_call items,
   * tool result messages → function_call_output items,
   * and final assistant message → message item.
   */
  private extractOutputItems(
    state: AgentState,
    responseId: string,
  ): { output: OutputItem[]; outputText: string } {
    if (!state.messages?.length) return { output: [], outputText: '' };

    const output: OutputItem[] = [];
    let outputText = '';
    let itemCounter = 0;

    // Skip system messages; process assistant and tool messages in order
    for (const msg of state.messages) {
      if (msg.role === 'assistant') {
        const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;

        // Emit message item for assistant text content (even when tool_calls are present)
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (content) {
          outputText = content;
          output.push({
            content: [
              { annotations: [], logprobs: [], text: content, type: 'output_text' as const },
            ],
            id: `msg_${responseId}_${itemCounter++}`,
            role: 'assistant' as const,
            status: 'completed' as const,
            type: 'message' as const,
          });
        }

        // Handle tool_calls from assistant
        if (hasToolCalls) {
          for (const toolCall of msg.tool_calls) {
            // Decode internal tool name format back to display name
            const fnName = this.decodeToolName(toolCall.function?.name ?? '');
            output.push({
              arguments: toolCall.function?.arguments ?? '{}',
              call_id: toolCall.id ?? `call_${itemCounter}`,
              id: `fc_${responseId}_${itemCounter++}`,
              name: fnName,
              status: 'completed' as const,
              type: 'function_call' as const,
            });
          }
        }
      } else if (msg.role === 'tool') {
        output.push({
          call_id: msg.tool_call_id ?? '',
          id: `fco_${responseId}_${itemCounter++}`,
          output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          status: 'completed' as const,
          type: 'function_call_output' as const,
        });
      }
    }

    return { output, outputText };
  }

  /**
   * Decode internal tool name format to display name.
   * - lobe-client-fn____get_weather → get_weather
   * - lobe-cloud-sandbox____executeCode____builtin → lobe-cloud-sandbox/executeCode
   * - my-plugin____myApi → my-plugin/myApi
   */
  private decodeToolName(rawName: string): string {
    const SEPARATOR = '____';
    if (rawName.startsWith(`lobe-client-fn${SEPARATOR}`)) {
      return rawName.slice(`lobe-client-fn${SEPARATOR}`.length);
    }
    const parts = rawName.split(SEPARATOR);
    if (parts.length >= 2) {
      // parts[0] = identifier, parts[1] = apiName, parts[2+] = type (ignored for display)
      return `${parts[0]}/${parts[1]}`;
    }
    return rawName;
  }

  /**
   * Extract usage from AgentState
   */
  private extractUsage(state: AgentState): ResponseUsage {
    const tokens = state.usage?.llm?.tokens;
    return {
      input_tokens: tokens?.input ?? 0,
      output_tokens: tokens?.output ?? 0,
      total_tokens: tokens?.total ?? 0,
    };
  }

  /**
   * Create a response (non-streaming)
   * Calls execAgent with autoStart: false, then executeSync to wait for completion
   */
  async createResponse(params: CreateResponseRequest): Promise<ResponseObject> {
    const createdAt = Math.floor(Date.now() / 1000);

    try {
      const model = params.model;
      const instructions = this.buildInstructions(params);

      // Resolve topicId from previous_response_id for multi-turn
      const previousTopicId = params.previous_response_id
        ? this.extractTopicIdFromResponseId(params.previous_response_id)
        : null;

      // Check for function_call_output resume flow
      const functionCallOutputs = this.extractFunctionCallOutputs(params.input);
      const isResumeFlow = functionCallOutputs.length > 0 && previousTopicId;

      const prompt = isResumeFlow
        ? this.buildToolResultPrompt(functionCallOutputs)
        : this.extractPrompt(params.input);

      this.log('info', 'Creating response via execAgent', {
        hasInstructions: !!instructions,
        isResumeFlow,
        model,
        previousTopicId,
        prompt: prompt.slice(0, 50),
      });

      // 1. Create agent operation without auto-start
      // model field is used as agentId
      const additionalPluginIds = this.extractHostedToolIds(params.tools);
      const functionTools = this.extractFunctionTools(params.tools);
      const aiAgentService = new AiAgentService(this.db, this.userId);
      const execResult = await aiAgentService.execAgent({
        additionalPluginIds: additionalPluginIds.length > 0 ? additionalPluginIds : undefined,
        agentId: model,
        appContext: previousTopicId ? { topicId: previousTopicId } : undefined,
        autoStart: false,
        functionTools: functionTools.length > 0 ? functionTools : undefined,
        instructions,
        prompt,
        stream: false,
      });

      if (!execResult.success) {
        throw new Error(execResult.error || 'Failed to create agent operation');
      }

      // Generate response ID encoding topicId for multi-turn support
      const responseId = this.generateResponseId(execResult.topicId);

      // 2. Execute synchronously to completion
      const agentRuntimeService = new AgentRuntimeService(this.db, this.userId, {
        queueService: null,
      });
      const finalState = await agentRuntimeService.executeSync(execResult.operationId);

      // 3. Extract results from final state
      const { output, outputText } = this.extractOutputItems(finalState, responseId);
      const usage = this.extractUsage(finalState);

      const isClientToolInterrupt =
        finalState.status === 'interrupted' &&
        finalState.interruption?.reason === 'client_tool_execution';

      return this.buildResponseObject({
        completedAt: isClientToolInterrupt ? null : Math.floor(Date.now() / 1000),
        createdAt,
        id: responseId,
        incompleteDetails: isClientToolInterrupt ? { reason: 'client_tool_execution' } : undefined,
        output,
        outputText,
        params,
        status: isClientToolInterrupt
          ? 'incomplete'
          : finalState.status === 'error'
            ? 'failed'
            : 'completed',
        usage,
      });
    } catch (error) {
      const errorResponseId = this.generateResponseId();
      this.log('error', 'Response creation failed', { error, responseId: errorResponseId });

      return this.buildResponseObject({
        createdAt,
        error: {
          code: 'server_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        id: errorResponseId,
        output: [],
        outputText: '',
        params,
        status: 'failed',
      });
    }
  }

  /**
   * Create a streaming response with real token-level streaming
   * Subscribes to Agent Runtime stream events and converts to OpenResponses SSE events
   */
  async *createStreamingResponse(
    params: CreateResponseRequest,
  ): AsyncGenerator<ResponseStreamEvent> {
    const createdAt = Math.floor(Date.now() / 1000);
    let sequenceNumber = 0;

    try {
      const model = params.model;
      const instructions = this.buildInstructions(params);

      // Resolve topicId from previous_response_id for multi-turn
      const previousTopicId = params.previous_response_id
        ? this.extractTopicIdFromResponseId(params.previous_response_id)
        : null;

      // Check for function_call_output resume flow
      const functionCallOutputs = this.extractFunctionCallOutputs(params.input);
      const isResumeFlow = functionCallOutputs.length > 0 && previousTopicId;

      const prompt = isResumeFlow
        ? this.buildToolResultPrompt(functionCallOutputs)
        : this.extractPrompt(params.input);

      // 1. Create agent operation (before generating responseId so we have topicId)
      // model field is used as agentId
      const additionalPluginIds = this.extractHostedToolIds(params.tools);
      const functionTools = this.extractFunctionTools(params.tools);
      const aiAgentService = new AiAgentService(this.db, this.userId);
      const execResult = await aiAgentService.execAgent({
        additionalPluginIds: additionalPluginIds.length > 0 ? additionalPluginIds : undefined,
        agentId: model,
        appContext: previousTopicId ? { topicId: previousTopicId } : undefined,
        autoStart: false,
        functionTools: functionTools.length > 0 ? functionTools : undefined,
        instructions,
        prompt,
        stream: true,
      });

      if (!execResult.success) {
        throw new Error(execResult.error || 'Failed to create agent operation');
      }

      const operationId = execResult.operationId;

      // Generate response ID encoding topicId for multi-turn support
      const responseId = this.generateResponseId(execResult.topicId);

      const response = this.buildResponseObject({
        createdAt,
        id: responseId,
        output: [],
        outputText: '',
        params,
        status: 'in_progress',
      });

      // Emit response.created + response.in_progress
      yield { response, sequence_number: sequenceNumber++, type: 'response.created' as const };
      yield {
        response,
        sequence_number: sequenceNumber++,
        type: 'response.in_progress' as const,
      };

      // 2. Create AgentRuntimeService with custom stream manager for event subscription
      const streamEventManager = new InMemoryStreamEventManager();
      const agentRuntimeService = new AgentRuntimeService(this.db, this.userId, {
        queueService: null,
        streamEventManager,
      });

      // 3. Setup async event queue to bridge push events → pull-based generator
      const eventQueue: StreamEvent[] = [];
      let resolveWaiting: (() => void) | null = null;
      let executionDone = false;

      const unsubscribe = streamEventManager.subscribe(operationId, (events) => {
        eventQueue.push(...events);
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      });

      // Helper to wait for next event batch
      const waitForEvents = (): Promise<void> =>
        new Promise((resolve) => {
          if (eventQueue.length > 0 || executionDone) {
            resolve();
          } else {
            resolveWaiting = resolve;
          }
        });

      // 4. Start execution in background
      let finalState: AgentState | undefined;
      const executionPromise = agentRuntimeService
        .executeSync(operationId)
        .then((state) => {
          finalState = state;
        })
        .catch((err) => {
          finalState = { status: 'error' } as AgentState;
          this.log('error', 'Streaming execution failed', { error: err, responseId });
        })
        .finally(() => {
          executionDone = true;
          if (resolveWaiting) {
            resolveWaiting();
            resolveWaiting = null;
          }
        });

      // 5. Process stream events and emit output items
      let accumulatedText = '';
      let currentOutputIndex = 0;
      let itemCounter = 0;
      let textMessageStarted = false;

      // Track active (in-progress) tool calls for proper incremental streaming
      const activeToolCalls = new Map<
        string,
        { fcItemId: string; name: string; outputIndex: number; prevArguments: string }
      >();
      let currentTextItemId = '';

      const startTextMessage = function* (seq: { n: number }) {
        if (textMessageStarted) return;
        textMessageStarted = true;
        currentTextItemId = `msg_${responseId}_${itemCounter++}`;
        const item: OutputItem = {
          content: [{ annotations: [], logprobs: [], text: '', type: 'output_text' as const }],
          id: currentTextItemId,
          role: 'assistant' as const,
          status: 'in_progress' as const,
          type: 'message' as const,
        };
        yield {
          item,
          output_index: currentOutputIndex,
          sequence_number: seq.n++,
          type: 'response.output_item.added' as const,
        };
        yield {
          content_index: 0,
          item_id: currentTextItemId,
          output_index: currentOutputIndex,
          part: { annotations: [], logprobs: [], text: '', type: 'output_text' as const },
          sequence_number: seq.n++,
          type: 'response.content_part.added' as const,
        };
      };

      const finishTextMessage = function* (seq: { n: number }, text: string) {
        if (!textMessageStarted) return;
        textMessageStarted = false;

        yield {
          content_index: 0,
          item_id: currentTextItemId,
          logprobs: [],
          output_index: currentOutputIndex,
          sequence_number: seq.n++,
          text,
          type: 'response.output_text.done' as const,
        };
        yield {
          content_index: 0,
          item_id: currentTextItemId,
          output_index: currentOutputIndex,
          part: { annotations: [], logprobs: [], text, type: 'output_text' as const },
          sequence_number: seq.n++,
          type: 'response.content_part.done' as const,
        };
        yield {
          item: {
            content: [{ annotations: [], logprobs: [], text, type: 'output_text' as const }],
            id: currentTextItemId,
            role: 'assistant' as const,
            status: 'completed' as const,
            type: 'message' as const,
          } as OutputItem,
          output_index: currentOutputIndex,
          sequence_number: seq.n++,
          type: 'response.output_item.done' as const,
        };
        currentOutputIndex++;
      };

      const finishActiveToolCalls = function* (seq: { n: number }) {
        for (const [callId, tc] of activeToolCalls) {
          yield {
            arguments: tc.prevArguments || '{}',
            item_id: tc.fcItemId,
            output_index: tc.outputIndex,
            sequence_number: seq.n++,
            type: 'response.function_call_arguments.done' as const,
          };
          yield {
            item: {
              arguments: tc.prevArguments || '{}',
              call_id: callId,
              id: tc.fcItemId,
              name: tc.name,
              status: 'completed' as const,
              type: 'function_call' as const,
            } as OutputItem,
            output_index: tc.outputIndex,
            sequence_number: seq.n++,
            type: 'response.output_item.done' as const,
          };
        }
        if (activeToolCalls.size > 0) {
          currentOutputIndex += activeToolCalls.size;
          activeToolCalls.clear();
        }
      };

      // Shared mutable sequence counter for generators
      const seq = { n: sequenceNumber };

      while (!executionDone || eventQueue.length > 0) {
        await waitForEvents();

        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;

          if (event.type === 'stream_chunk') {
            const chunk = event.data as StreamChunkData;

            if (chunk.chunkType === 'text' && chunk.content) {
              // Start text message output item if not already started
              yield* startTextMessage(seq);

              accumulatedText += chunk.content;
              yield {
                content_index: 0,
                delta: chunk.content,
                item_id: currentTextItemId,
                logprobs: [],
                output_index: currentOutputIndex,
                sequence_number: seq.n++,
                type: 'response.output_text.delta' as const,
              };
            } else if (chunk.chunkType === 'tools_calling' && chunk.toolsCalling) {
              // Close any open text message before emitting tool calls
              yield* finishTextMessage(seq, accumulatedText);
              accumulatedText = '';

              // Stream tool call deltas incrementally within stable output items
              for (const toolCall of chunk.toolsCalling) {
                const callId = toolCall.id;
                const existing = activeToolCalls.get(callId);

                if (!existing) {
                  // First time seeing this tool call — emit output_item.added
                  const fcItemId = `fc_${responseId}_${itemCounter++}`;
                  const isClientTool = toolCall.identifier === 'lobe-client-fn';
                  const toolDisplayName = isClientTool
                    ? toolCall.apiName
                    : `${toolCall.identifier}/${toolCall.apiName}`;
                  const outputIndex = currentOutputIndex + activeToolCalls.size;

                  activeToolCalls.set(callId, {
                    fcItemId,
                    name: toolDisplayName,
                    outputIndex,
                    prevArguments: '',
                  });

                  yield {
                    item: {
                      arguments: '',
                      call_id: callId,
                      id: fcItemId,
                      name: toolDisplayName,
                      status: 'in_progress' as const,
                      type: 'function_call' as const,
                    } as OutputItem,
                    output_index: outputIndex,
                    sequence_number: seq.n++,
                    type: 'response.output_item.added' as const,
                  };

                  // Emit initial delta if arguments already present
                  if (toolCall.arguments) {
                    activeToolCalls.get(callId)!.prevArguments = toolCall.arguments;
                    yield {
                      delta: toolCall.arguments,
                      item_id: fcItemId,
                      output_index: outputIndex,
                      sequence_number: seq.n++,
                      type: 'response.function_call_arguments.delta' as const,
                    };
                  }
                } else {
                  // Subsequent chunk — compute incremental delta
                  const currentArgs = toolCall.arguments ?? '';
                  const delta = currentArgs.slice(existing.prevArguments.length);

                  if (delta) {
                    existing.prevArguments = currentArgs;
                    yield {
                      delta,
                      item_id: existing.fcItemId,
                      output_index: existing.outputIndex,
                      sequence_number: seq.n++,
                      type: 'response.function_call_arguments.delta' as const,
                    };
                  }
                }
              }
            } else if (chunk.chunkType === 'reasoning' && chunk.reasoning) {
              // Emit reasoning as text delta (within a text message)
              yield* startTextMessage(seq);
            }
          } else if (event.type === 'tool_end') {
            // Finalize any remaining active tool calls before emitting tool output
            yield* finishActiveToolCalls(seq);

            // Emit function_call_output for completed tool execution
            const toolData = event.data as {
              isSuccess: boolean;
              payload: { toolCalling: { id: string } };
              result: { content: string };
            };
            const fcoItemId = `fco_${responseId}_${itemCounter++}`;

            yield {
              item: {
                call_id: toolData.payload.toolCalling.id,
                id: fcoItemId,
                output: toolData.result?.content ?? '',
                status: 'completed' as const,
                type: 'function_call_output' as const,
              } as OutputItem,
              output_index: currentOutputIndex,
              sequence_number: seq.n++,
              type: 'response.output_item.added' as const,
            };
            yield {
              item: {
                call_id: toolData.payload.toolCalling.id,
                id: fcoItemId,
                output: toolData.result?.content ?? '',
                status: 'completed' as const,
                type: 'function_call_output' as const,
              } as OutputItem,
              output_index: currentOutputIndex,
              sequence_number: seq.n++,
              type: 'response.output_item.done' as const,
            };
            currentOutputIndex++;
          } else if (event.type === 'stream_retry') {
            // LLM retry — discard stale tool call state from the failed attempt
            // so we don't emit phantom function_calls on final flush
            activeToolCalls.clear();
          }
        }
      }

      // Finalize any in-progress tool calls
      yield* finishActiveToolCalls(seq);

      // Close any remaining open text message
      yield* finishTextMessage(seq, accumulatedText);
      sequenceNumber = seq.n;

      // 6. Wait for execution to fully complete
      await executionPromise;
      unsubscribe();

      // If no text came through streaming, extract from final state
      if (!accumulatedText && finalState) {
        accumulatedText = this.extractAssistantContent(finalState);
      }

      const usage = finalState
        ? this.extractUsage(finalState)
        : { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

      // 7. Build final output including tool calls from AgentState
      const fullOutput = finalState
        ? this.extractOutputItems(finalState, responseId)
        : { output: [], outputText: accumulatedText };

      // Determine if agent was interrupted for client tool execution
      const isClientToolInterrupt =
        finalState?.status === 'interrupted' &&
        finalState?.interruption?.reason === 'client_tool_execution';

      if (isClientToolInterrupt) {
        yield {
          response: {
            ...response,
            completed_at: null,
            incomplete_details: { reason: 'client_tool_execution' },
            output: fullOutput.output,
            output_text: fullOutput.outputText || accumulatedText,
            status: 'incomplete' as any,
            usage: {
              input_tokens: usage.input_tokens,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: usage.output_tokens,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: usage.total_tokens,
            },
          },
          sequence_number: sequenceNumber,
          type: 'response.incomplete' as const,
        };
      } else {
        yield {
          response: {
            ...response,
            completed_at: Math.floor(Date.now() / 1000),
            output: fullOutput.output,
            output_text: fullOutput.outputText || accumulatedText,
            status: (finalState?.status === 'error' ? 'failed' : 'completed') as any,
            usage: {
              input_tokens: usage.input_tokens,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: usage.output_tokens,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: usage.total_tokens,
            },
          },
          sequence_number: sequenceNumber,
          type: 'response.completed' as const,
        };
      }
    } catch (error) {
      const errorResponseId = this.generateResponseId();
      this.log('error', 'Streaming response failed', { error, responseId: errorResponseId });

      const errorResponse = this.buildResponseObject({
        createdAt,
        error: {
          code: 'server_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        id: errorResponseId,
        output: [],
        outputText: '',
        params,
        status: 'failed',
      });

      yield {
        response: errorResponse,
        sequence_number: sequenceNumber,
        type: 'response.failed' as const,
      };
    }
  }

  /**
   * Generate a response ID.
   * Uses topicId directly as the response ID for multi-turn support.
   * When no topicId is available, generates a random ID.
   */
  private generateResponseId(topicId?: string): string {
    if (topicId) return topicId;

    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 24; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  /**
   * Extract topicId from a response ID (previous_response_id).
   * Since response ID is the topicId itself, just return it directly.
   */
  private extractTopicIdFromResponseId(responseId: string): string | null {
    return responseId || null;
  }

  private buildResponseObject(opts: {
    completedAt?: number | null;
    createdAt: number;
    error?: { code: 'server_error'; message: string };
    id: string;
    incompleteDetails?: { reason: string };
    output: OutputItem[];
    outputText: string;
    params: CreateResponseRequest;
    status: ResponseObject['status'];
    usage?: ResponseUsage;
  }): ResponseObject {
    const p = opts.params as Record<string, any>;
    return {
      background: p.background ?? false,
      completed_at: opts.completedAt ?? null,
      created_at: opts.createdAt,
      error: opts.error ?? null,
      frequency_penalty: p.frequency_penalty ?? 0,
      id: opts.id,
      incomplete_details: opts.incompleteDetails ?? null,
      instructions: opts.params.instructions ?? null,
      max_output_tokens: opts.params.max_output_tokens ?? null,
      max_tool_calls: p.max_tool_calls ?? null,
      metadata: opts.params.metadata ?? {},
      model: opts.params.model,
      object: 'response',
      output: opts.output,
      output_text: opts.outputText,
      parallel_tool_calls: opts.params.parallel_tool_calls ?? true,
      presence_penalty: p.presence_penalty ?? 0,
      previous_response_id: opts.params.previous_response_id ?? null,
      prompt_cache_key: p.prompt_cache_key ?? null,
      reasoning: opts.params.reasoning ?? null,
      safety_identifier: p.safety_identifier ?? null,
      service_tier: p.service_tier ?? 'default',
      status: opts.status,
      store: p.store ?? true,
      temperature: opts.params.temperature ?? 1,
      text: { format: { type: 'text' } },
      tool_choice: opts.params.tool_choice ?? 'auto',
      tools: opts.params.tools?.map((t: any) => ({ ...t, strict: t.strict ?? null })) ?? [],
      top_logprobs: p.top_logprobs ?? 0,
      top_p: opts.params.top_p ?? 1,
      truncation:
        opts.params.truncation && typeof opts.params.truncation === 'object'
          ? opts.params.truncation.type
          : (opts.params.truncation ?? 'disabled'),
      usage: {
        input_tokens: opts.usage?.input_tokens ?? 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: opts.usage?.output_tokens ?? 0,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: opts.usage?.total_tokens ?? 0,
      },
      user: opts.params.user ?? null,
    } as any;
  }
}
