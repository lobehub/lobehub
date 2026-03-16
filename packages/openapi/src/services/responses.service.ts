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
  InputItem,
  OutputItem,
  ResponseObject,
  ResponseStreamEvent,
  ResponseUsage,
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

        // Handle tool_calls from assistant
        if (hasToolCalls) {
          for (const toolCall of msg.tool_calls) {
            output.push({
              arguments: toolCall.function?.arguments ?? '{}',
              call_id: toolCall.id ?? `call_${itemCounter}`,
              id: `fc_${responseId.slice(5)}_${itemCounter++}`,
              name: toolCall.function?.name ?? '',
              status: 'completed' as const,
              type: 'function_call' as const,
            });
          }
        }

        // Only emit message item for assistant messages WITHOUT tool_calls (i.e., final text response)
        if (!hasToolCalls) {
          const content = typeof msg.content === 'string' ? msg.content : '';
          if (content) {
            outputText = content;
            output.push({
              content: [
                { annotations: [], logprobs: [], text: content, type: 'output_text' as const },
              ],
              id: `msg_${responseId.slice(5)}_${itemCounter++}`,
              role: 'assistant' as const,
              status: 'completed' as const,
              type: 'message' as const,
            });
          }
        }
      } else if (msg.role === 'tool') {
        output.push({
          call_id: msg.tool_call_id ?? '',
          id: `fco_${responseId.slice(5)}_${itemCounter++}`,
          output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          status: 'completed' as const,
          type: 'function_call_output' as const,
        });
      }
    }

    return { output, outputText };
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
      const prompt = this.extractPrompt(params.input);
      const instructions = this.buildInstructions(params);

      // Resolve topicId from previous_response_id for multi-turn
      const previousTopicId = params.previous_response_id
        ? this.extractTopicIdFromResponseId(params.previous_response_id)
        : null;

      this.log('info', 'Creating response via execAgent', {
        hasInstructions: !!instructions,
        model,
        previousTopicId,
        prompt: prompt.slice(0, 50),
      });

      // 1. Create agent operation without auto-start
      // model field is used as agentId
      const aiAgentService = new AiAgentService(this.db, this.userId);
      const execResult = await aiAgentService.execAgent({
        agentId: model,
        appContext: previousTopicId ? { topicId: previousTopicId } : undefined,
        autoStart: false,
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

      return this.buildResponseObject({
        completedAt: Math.floor(Date.now() / 1000),
        createdAt,
        id: responseId,
        output,
        outputText,
        params,
        status: finalState.status === 'error' ? 'failed' : 'completed',
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
    const outputIndex = 0;
    const contentIndex = 0;

    try {
      const model = params.model;
      const prompt = this.extractPrompt(params.input);
      const instructions = this.buildInstructions(params);

      // Resolve topicId from previous_response_id for multi-turn
      const previousTopicId = params.previous_response_id
        ? this.extractTopicIdFromResponseId(params.previous_response_id)
        : null;

      // 1. Create agent operation (before generating responseId so we have topicId)
      // model field is used as agentId
      const aiAgentService = new AiAgentService(this.db, this.userId);
      const execResult = await aiAgentService.execAgent({
        agentId: model,
        appContext: previousTopicId ? { topicId: previousTopicId } : undefined,
        autoStart: false,
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
      const outputItemId = `msg_${responseId.slice(5)}`;

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

      // 5. Emit output_item.added + content_part.added immediately
      const outputItem: OutputItem = {
        content: [{ annotations: [], logprobs: [], text: '', type: 'output_text' as const }],
        id: outputItemId,
        role: 'assistant' as const,
        status: 'in_progress' as const,
        type: 'message' as const,
      };

      yield {
        item: outputItem,
        output_index: outputIndex,
        sequence_number: sequenceNumber++,
        type: 'response.output_item.added' as const,
      };
      yield {
        content_index: contentIndex,
        item_id: outputItemId,
        output_index: outputIndex,
        part: { annotations: [], logprobs: [], text: '', type: 'output_text' as const },
        sequence_number: sequenceNumber++,
        type: 'response.content_part.added' as const,
      };

      // 6. Process stream events and emit text deltas
      let accumulatedText = '';

      while (!executionDone || eventQueue.length > 0) {
        await waitForEvents();

        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;

          if (event.type === 'stream_chunk') {
            const chunk = event.data as StreamChunkData;
            if (chunk.chunkType === 'text' && chunk.content) {
              accumulatedText += chunk.content;
              yield {
                content_index: contentIndex,
                delta: chunk.content,
                item_id: outputItemId,
                logprobs: [],
                output_index: outputIndex,
                sequence_number: sequenceNumber++,
                type: 'response.output_text.delta' as const,
              };
            }
          }
        }
      }

      // 7. Wait for execution to fully complete
      await executionPromise;
      unsubscribe();

      // If no text came through streaming, extract from final state
      if (!accumulatedText && finalState) {
        accumulatedText = this.extractAssistantContent(finalState);
      }

      const usage = finalState
        ? this.extractUsage(finalState)
        : { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

      // 8. Emit closing events for text content
      yield {
        content_index: contentIndex,
        item_id: outputItemId,
        logprobs: [],
        output_index: outputIndex,
        sequence_number: sequenceNumber++,
        text: accumulatedText,
        type: 'response.output_text.done' as const,
      };

      yield {
        content_index: contentIndex,
        item_id: outputItemId,
        output_index: outputIndex,
        part: {
          annotations: [],
          logprobs: [],
          text: accumulatedText,
          type: 'output_text' as const,
        },
        sequence_number: sequenceNumber++,
        type: 'response.content_part.done' as const,
      };

      const completedItem: OutputItem = {
        content: [
          { annotations: [], logprobs: [], text: accumulatedText, type: 'output_text' as const },
        ],
        id: outputItemId,
        role: 'assistant' as const,
        status: 'completed' as const,
        type: 'message' as const,
      };

      yield {
        item: completedItem,
        output_index: outputIndex,
        sequence_number: sequenceNumber++,
        type: 'response.output_item.done' as const,
      };

      // 9. Build final output including tool calls from AgentState
      const fullOutput = finalState
        ? this.extractOutputItems(finalState, responseId)
        : { output: [completedItem], outputText: accumulatedText };

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
   * Generate a response ID that encodes the topicId for multi-turn support.
   * Format: resp_{topicId}_{8-char-random-suffix}
   * When no topicId is available, generates a plain random ID.
   */
  private generateResponseId(topicId?: string): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 8; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    if (topicId) {
      return `resp_${topicId}_${suffix}`;
    }
    // Fallback: plain 24-char random ID
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return `resp_${id}_${suffix}`;
  }

  /**
   * Extract topicId from a response ID (previous_response_id).
   * Reverses the encoding from generateResponseId.
   */
  private extractTopicIdFromResponseId(responseId: string): string | null {
    if (!responseId.startsWith('resp_')) return null;
    const withoutPrefix = responseId.slice(5); // remove "resp_"
    const lastUnderscore = withoutPrefix.lastIndexOf('_');
    if (lastUnderscore === -1) return null;
    const topicId = withoutPrefix.slice(0, lastUnderscore);
    return topicId || null;
  }

  private buildResponseObject(opts: {
    completedAt?: number | null;
    createdAt: number;
    error?: { code: 'server_error'; message: string };
    id: string;
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
      incomplete_details: null,
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
