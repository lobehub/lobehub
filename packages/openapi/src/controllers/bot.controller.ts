import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { BotRestService } from '../services/bot.service';
import type {
  BotIdParam,
  BotListQuery,
  CreateBotRequest,
  SendBotMessageRequest,
  UpdateBotRequest,
} from '../types/bot.type';

/**
 * Agent bots controller.
 * Handles HTTP concerns only — bot management lives in the `agentBotProvider`
 * and `botMessage` procedures, wrapped by `BotRestService`.
 */
export class BotController extends BaseController {
  private async service(c: Context): Promise<BotRestService> {
    return new BotRestService(await this.getDatabase(), this.getUserId(c), this.getWorkspaceId(c));
  }

  private async run(c: Context, action: (service: BotRestService) => Promise<Response>) {
    try {
      return await action(await this.service(c));
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/bots */
  async listBots(c: Context): Promise<Response> {
    return this.run(c, async (service) => {
      const query = this.getQuery<BotListQuery>(c);
      return this.list(c, 'items', await service.list(query), {
        message: 'Bot list retrieved successfully',
        pagination: query,
      });
    });
  }

  /** POST /api/v1/bots */
  async createBot(c: Context): Promise<Response> {
    return this.run(c, async (service) =>
      this.success(
        c,
        await service.create(await this.getBody<CreateBotRequest>(c)),
        'Bot created',
        201,
      ),
    );
  }

  /** GET /api/v1/bots/:id */
  async getBot(c: Context): Promise<Response> {
    return this.run(c, async (service) =>
      this.success(c, await service.get(this.getParams<BotIdParam>(c).id), 'Bot retrieved'),
    );
  }

  /** PATCH /api/v1/bots/:id */
  async updateBot(c: Context): Promise<Response> {
    return this.run(c, async (service) => {
      const { id } = this.getParams<BotIdParam>(c);
      const body = await this.getBody<UpdateBotRequest>(c);
      return this.success(c, await service.update(id, body), 'Bot updated');
    });
  }

  /** DELETE /api/v1/bots/:id */
  async deleteBot(c: Context): Promise<Response> {
    return this.run(c, async (service) =>
      this.success(c, await service.delete(this.getParams<BotIdParam>(c).id), 'Bot deleted'),
    );
  }

  /** POST /api/v1/bots/:id/enable */
  async enableBot(c: Context): Promise<Response> {
    return this.run(c, async (service) =>
      this.success(c, await service.enable(this.getParams<BotIdParam>(c).id), 'Bot enabled'),
    );
  }

  /** POST /api/v1/bots/:id/disable */
  async disableBot(c: Context): Promise<Response> {
    return this.run(c, async (service) =>
      this.success(c, await service.disable(this.getParams<BotIdParam>(c).id), 'Bot disabled'),
    );
  }

  /** POST /api/v1/bots/:id/test */
  async testBot(c: Context): Promise<Response> {
    return this.run(c, async (service) =>
      this.success(c, await service.test(this.getParams<BotIdParam>(c).id), 'Connection tested'),
    );
  }

  /** POST /api/v1/bots/:id/messages */
  async sendBotMessage(c: Context): Promise<Response> {
    return this.run(c, async (service) => {
      const { id } = this.getParams<BotIdParam>(c);
      const body = await this.getBody<SendBotMessageRequest>(c);
      return this.success(c, await service.sendMessage(id, body), 'Message sent', 201);
    });
  }
}
