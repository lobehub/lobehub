import type { AgentState } from '@lobechat/agent-runtime';

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
 * The `model` field is treated as an agent slug.
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
    const responseId = this.generateResponseId();
    const createdAt = Math.floor(Date.now() / 1000);

    try {
      const slug = params.model;
      const prompt = this.extractPrompt(params.input);
      const instructions = this.buildInstructions(params);

      this.log('info', 'Creating response via execAgent', {
        hasInstructions: !!instructions,
        prompt: prompt.slice(0, 50),
        responseId,
        slug,
      });

      // 1. Create agent operation without auto-start
      const aiAgentService = new AiAgentService(this.db, this.userId);
      const execResult = await aiAgentService.execAgent({
        autoStart: false,
        instructions,
        prompt,
        slug,
        stream: false,
      });

      if (!execResult.success) {
        throw new Error(execResult.error || 'Failed to create agent operation');
      }

      // 2. Execute synchronously to completion
      const agentRuntimeService = new AgentRuntimeService(this.db, this.userId, {
        queueService: null,
      });
      const finalState = await agentRuntimeService.executeSync(execResult.operationId);

      // 3. Extract results from final state
      const content = this.extractAssistantContent(finalState);
      const usage = this.extractUsage(finalState);

      const outputItemId = `msg_${responseId.slice(5)}`;
      const output: OutputItem[] = content
        ? [
            {
              content: [
                { annotations: [], logprobs: [], text: content, type: 'output_text' as const },
              ],
              id: outputItemId,
              role: 'assistant' as const,
              status: 'completed' as const,
              type: 'message' as const,
            },
          ]
        : [];

      return this.buildResponseObject({
        completedAt: Math.floor(Date.now() / 1000),
        createdAt,
        id: responseId,
        output,
        outputText: content,
        params,
        status: finalState.status === 'error' ? 'failed' : 'completed',
        usage,
      });
    } catch (error) {
      this.log('error', 'Response creation failed', { error, responseId });

      return this.buildResponseObject({
        createdAt,
        error: {
          code: 'server_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        id: responseId,
        output: [],
        outputText: '',
        params,
        status: 'failed',
      });
    }
  }

  /**
   * Create a streaming response
   * Calls execAgent, waits for completion via executeSync,
   * then emits OpenResponses SSE events from the result
   */
  async *createStreamingResponse(
    params: CreateResponseRequest,
  ): AsyncGenerator<ResponseStreamEvent> {
    const responseId = this.generateResponseId();
    const createdAt = Math.floor(Date.now() / 1000);
    let sequenceNumber = 0;

    const response = this.buildResponseObject({
      createdAt,
      id: responseId,
      output: [],
      outputText: '',
      params,
      status: 'in_progress',
    });

    // Emit response.created
    yield {
      response,
      sequence_number: sequenceNumber++,
      type: 'response.created' as const,
    };

    // Emit response.in_progress
    yield {
      response,
      sequence_number: sequenceNumber++,
      type: 'response.in_progress' as const,
    };

    try {
      const slug = params.model;
      const prompt = this.extractPrompt(params.input);
      const instructions = this.buildInstructions(params);

      const aiAgentService = new AiAgentService(this.db, this.userId);
      const execResult = await aiAgentService.execAgent({
        autoStart: false,
        instructions,
        prompt,
        slug,
        stream: false,
      });

      if (!execResult.success) {
        throw new Error(execResult.error || 'Failed to create agent operation');
      }

      const agentRuntimeService = new AgentRuntimeService(this.db, this.userId, {
        queueService: null,
      });
      const finalState = await agentRuntimeService.executeSync(execResult.operationId);

      const content = this.extractAssistantContent(finalState);
      const usage = this.extractUsage(finalState);
      const outputItemId = `msg_${responseId.slice(5)}`;
      const outputIndex = 0;
      const contentIndex = 0;

      // Emit output_item.added
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

      // Emit content_part.added
      yield {
        content_index: contentIndex,
        output_index: outputIndex,
        part: { annotations: [], logprobs: [], text: '', type: 'output_text' as const },
        sequence_number: sequenceNumber++,
        type: 'response.content_part.added' as const,
      };

      // Emit full text as a single delta
      if (content) {
        yield {
          content_index: contentIndex,
          delta: content,
          output_index: outputIndex,
          sequence_number: sequenceNumber++,
          type: 'response.output_text.delta' as const,
        };
      }

      // Emit output_text.done
      yield {
        content_index: contentIndex,
        output_index: outputIndex,
        sequence_number: sequenceNumber++,
        text: content,
        type: 'response.output_text.done' as const,
      };

      // Emit content_part.done
      yield {
        content_index: contentIndex,
        output_index: outputIndex,
        part: { annotations: [], logprobs: [], text: content, type: 'output_text' as const },
        sequence_number: sequenceNumber++,
        type: 'response.content_part.done' as const,
      };

      // Emit output_item.done
      const completedItem: OutputItem = {
        content: [{ annotations: [], logprobs: [], text: content, type: 'output_text' as const }],
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

      // Emit response.completed
      yield {
        response: {
          ...response,
          completed_at: Math.floor(Date.now() / 1000),
          output: [completedItem],
          output_text: content,
          status: 'completed' as const,
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
      this.log('error', 'Streaming response failed', { error, responseId });

      yield {
        response: {
          ...response,
          error: {
            code: 'server_error' as const,
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          status: 'failed' as const,
        },
        sequence_number: sequenceNumber,
        type: 'response.failed' as const,
      };
    }
  }

  private generateResponseId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = 'resp_';
    for (let i = 0; i < 24; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
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
        typeof opts.params.truncation === 'object'
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
