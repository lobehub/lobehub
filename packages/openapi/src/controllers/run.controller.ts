import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';

import { BaseController } from '../common/base.controller';
import { RunRestService } from '../services/run.service';
import { runEventStream } from '../services/run-events';
import type {
  CreateRunRequest,
  QueueRunMessageRequest,
  ResolveRunInterventionRequest,
  RunEventsQuery,
  RunIdParam,
  RunInterventionParam,
  RunQueuedMessageParam,
  SubmitRunToolResultsRequest,
} from '../types/run.type';

/** A journal id: the only `Last-Event-ID` the stream can resume from. */
const EVENT_ID_PATTERN = /^(0|\d+-\d+)$/;

/**
 * Agent runs controller.
 * Handles HTTP concerns only — run behaviour lives in `RunRestService`.
 */
export class RunController extends BaseController {
  private async service(c: Context): Promise<RunRestService> {
    return new RunRestService(await this.getDatabase(), this.getUserId(c), this.getWorkspaceId(c));
  }

  /** POST /api/v1/runs */
  async createRun(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateRunRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createRun(body), 'Run accepted', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/runs/:id */
  async getRun(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<RunIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.getRun(id), 'Run retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/runs/:id/events — server-sent events. */
  async streamEvents(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<RunIdParam>(c);
      const { after } = this.getQuery<RunEventsQuery>(c);
      const lastEventId = c.req.header('Last-Event-ID')?.trim();
      if (lastEventId && !EVENT_ID_PATTERN.test(lastEventId)) {
        return this.error(c, 'Last-Event-ID is not an event id of this stream', 400);
      }
      const service = await this.service(c);
      // Authorize before the stream opens, so a refusal is a plain JSON error.
      await service.requireRun(id);

      return streamSSE(c, async (stream) => {
        const controller = new AbortController();
        stream.onAbort(() => controller.abort());
        const events = runEventStream({
          after: lastEventId || after || '0',
          journal: createStreamEventManager(),
          readRun: () => service.snapshot(id),
          runId: id,
          signal: controller.signal,
        });
        for await (const event of events) {
          if (event === null) {
            await stream.write(': ping\n\n');
            continue;
          }
          await stream.writeSSE({
            data: JSON.stringify(event),
            event: event.type,
            ...(event.id ? { id: event.id } : {}),
          });
        }
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/runs/:id/cancel */
  async cancelRun(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<RunIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.cancelRun(id), 'Run cancelled');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/runs/:id/interventions */
  async listInterventions(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<RunIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.listInterventions(id), 'Interventions retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/runs/:id/interventions/:interventionId */
  async resolveIntervention(c: Context): Promise<Response> {
    try {
      const { id, interventionId } = this.getParams<RunInterventionParam>(c);
      const body = await this.getBody<ResolveRunInterventionRequest>(c);
      const service = await this.service(c);
      return this.success(
        c,
        await service.resolveIntervention(id, interventionId, body),
        'Intervention resolved',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/runs/:id/tool-results */
  async submitToolResults(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<RunIdParam>(c);
      const body = await this.getBody<SubmitRunToolResultsRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.submitToolResults(id, body), 'Tool results accepted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/runs/:id/messages */
  async queueMessage(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<RunIdParam>(c);
      const body = await this.getBody<QueueRunMessageRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.queueMessage(id, body), 'Message queued', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/runs/:id/messages */
  async listQueuedMessages(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<RunIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.listQueuedMessages(id), 'Queued messages retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/runs/:id/messages/:messageId */
  async removeQueuedMessage(c: Context): Promise<Response> {
    try {
      const { id, messageId } = this.getParams<RunQueuedMessageParam>(c);
      const service = await this.service(c);
      return this.success(
        c,
        await service.removeQueuedMessage(id, messageId),
        'Queued message removed',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
