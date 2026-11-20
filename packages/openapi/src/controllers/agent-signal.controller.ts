import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { AgentSignalRestService } from '../services/agent-signal.service';
import type {
  EmitSourceEventRequest,
  ListReceiptsQuery,
  TriggerSourceEventRequest,
} from '../types/agent-signal.type';

/** Agent Signal controller — emit or synthesise the events that wake an agent. */
export class AgentSignalController extends BaseController {
  private async service(c: Context): Promise<AgentSignalRestService> {
    return new AgentSignalRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** POST /api/v1/signals/source-events */
  async emitSourceEvent(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<EmitSourceEventRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.emitSourceEvent(body), 'Source event enqueued', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/signals/trigger */
  async triggerSourceEvent(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<TriggerSourceEventRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.triggerSourceEvent(body), 'Source event triggered', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/signals/receipts */
  async listReceipts(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<ListReceiptsQuery>(c);
      const service = await this.service(c);
      return this.success(c, await service.listReceipts(query), 'Signal receipts retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
