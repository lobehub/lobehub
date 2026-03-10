import { BaseService } from '../common/base.service';
import type {
  CreateResponseRequest,
  OutputItem,
  ResponseObject,
  ResponseStreamEvent,
  ResponseUsage,
} from '../types/responses.type';

/**
 * Response API Service
 * Handles OpenResponses protocol request execution
 */
export class ResponsesService extends BaseService {
  /**
   * Create a response (non-streaming)
   * Converts OpenResponses input to agent messages, executes, and returns response object
   */
  async createResponse(params: CreateResponseRequest): Promise<ResponseObject> {
    const responseId = this.generateResponseId();
    const createdAt = Math.floor(Date.now() / 1000);

    try {
      // TODO: Convert input to agent messages and execute via AgentRuntime
      // For now, return a minimal valid response
      const output: OutputItem[] = [];
      const outputText = '';
      const usage: ResponseUsage = {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      };

      return this.buildResponseObject({
        completedAt: Math.floor(Date.now() / 1000),
        createdAt,
        id: responseId,
        output,
        outputText,
        params,
        status: 'completed',
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
   * Returns an async generator of SSE events
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

    // TODO: Execute agent and emit content delta events

    // Emit response.completed
    const completedResponse = {
      ...response,
      completed_at: Math.floor(Date.now() / 1000),
      status: 'completed' as const,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      },
    };

    yield {
      response: completedResponse,
      sequence_number: sequenceNumber,
      type: 'response.completed' as const,
    };
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
    return {
      completed_at: opts.completedAt ?? null,
      created_at: opts.createdAt,
      error: opts.error ?? null,
      id: opts.id,
      incomplete_details: null,
      instructions: opts.params.instructions ?? null,
      max_output_tokens: opts.params.max_output_tokens ?? null,
      metadata: opts.params.metadata ?? null,
      model: opts.params.model,
      object: 'response',
      output: opts.output,
      output_text: opts.outputText,
      parallel_tool_calls: opts.params.parallel_tool_calls ?? null,
      previous_response_id: opts.params.previous_response_id ?? null,
      reasoning: opts.params.reasoning ?? null,
      status: opts.status,
      temperature: opts.params.temperature ?? null,
      tool_choice: opts.params.tool_choice ?? null,
      tools: opts.params.tools ?? [],
      top_p: opts.params.top_p ?? null,
      truncation: opts.params.truncation ?? null,
      usage: opts.usage ?? null,
      user: opts.params.user ?? null,
    };
  }
}
