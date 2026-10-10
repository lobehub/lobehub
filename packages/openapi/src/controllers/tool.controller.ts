import type { Context } from 'hono';

import { resolvePrice } from '@/business/server/machine-payments/resolvePrice';

import { BaseController } from '../common/base.controller';
import { canCollectPayment } from '../middleware/machine-payment-gate';
import { ToolService } from '../services/tool.service';

export class ToolController extends BaseController {
  private readonly service = new ToolService();

  /**
   * The public catalog. Each API carries the path to call and its price, so an
   * agent can discover what it can buy without an account. `price` is `null`
   * when the API is not for sale: it then needs normal authentication.
   */
  async listTools(c: Context) {
    try {
      // Every API is called with POST at `<this path>/<identifier>/<api>`, and
      // that path is exactly the scope `machinePayment` prices and binds into
      // the challenge — so the advertised price is the one that will be charged.
      const base = new URL(c.req.url).pathname.replace(/\/$/, '');
      const sellable = canCollectPayment();

      const tools = await Promise.all(
        this.service.listTools().map(async (tool) => ({
          ...tool,
          apis: await Promise.all(
            tool.apis.map(async (api) => {
              const path = `${base}/${tool.identifier}/${api.name}`;
              const price = sellable ? await resolvePrice({ route: `POST ${path}` }) : null;

              return {
                ...api,
                method: 'POST',
                path,
                price: price ? { amount: price.amount, currency: price.currency } : null,
              };
            }),
          ),
        })),
      );

      return this.success(c, { tools }, 'Tools retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  async invokeTool(c: Context) {
    try {
      const { identifier, api } = c.req.param() as { api: string; identifier: string };
      const args = await c.req.json().catch(() => undefined);
      const userId = this.getUserId(c) ?? undefined;

      const result = await this.service.invoke({
        api,
        args,
        identifier,
        serverDB: userId ? await this.getDatabase() : undefined,
        signal: c.req.raw.signal,
        userId,
      });

      // The tool ran but could not do the job (search provider down, page
      // unreachable). That is an upstream failure, not a bad request.
      if (!result.success) return this.error(c, result.content || 'Tool execution failed', 502);

      return this.success(c, { content: result.content, state: result.state }, 'Tool executed');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
