import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

import { BaseController } from '../common/base.controller';
import { ResponsesService } from '../services/responses.service';
import type { CreateResponseRequest } from '../types/responses.type';

/**
 * Responses Controller
 * Handles OpenResponses API requests
 */
export class ResponsesController extends BaseController {
  /**
   * POST /api/v1/responses
   * Create a model response (streaming or non-streaming)
   */
  async createResponse(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateResponseRequest>(c);
      const userId = this.getUserId(c);
      const db = await this.getDatabase();
      const service = new ResponsesService(db, userId);

      if (body.stream) {
        return this.handleStreamingResponse(c, service, body);
      }

      const response = await service.createResponse(body);
      return c.json(response);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  private handleStreamingResponse(
    c: Context,
    service: ResponsesService,
    params: CreateResponseRequest,
  ): Response {
    return streamSSE(c, async (stream) => {
      const generator = service.createStreamingResponse(params);

      for await (const event of generator) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });
      }
    });
  }
}
