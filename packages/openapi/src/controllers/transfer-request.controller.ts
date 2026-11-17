import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { TransferRequestRestService } from '../services/transfer-request.service';
import { pageOf } from '../services/workspace.service';
import type {
  CreateTransferRequest,
  TransferRequestIdParam,
  TransferRequestListQuery,
} from '../types/transfer-request.type';

/**
 * Transfer requests controller.
 * Handles HTTP concerns only — the handover rules live in the tRPC routers.
 */
export class TransferRequestController extends BaseController {
  private async service(c: Context): Promise<TransferRequestRestService> {
    return new TransferRequestRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  private async run(c: Context, handler: () => Promise<Response>): Promise<Response> {
    try {
      return await handler();
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/transfer-requests */
  listTransferRequests(c: Context) {
    return this.run(c, async () => {
      const query = this.getQuery<TransferRequestListQuery>(c);
      const requests = await (await this.service(c)).listMine();
      return this.list(c, 'items', pageOf(requests, query), { pagination: query });
    });
  }

  /** POST /api/v1/transfer-requests */
  createTransferRequest(c: Context) {
    return this.run(c, async () => {
      const body = await this.getBody<CreateTransferRequest>(c);
      return this.success(
        c,
        await (await this.service(c)).create(body),
        'Transfer request created',
        201,
      );
    });
  }

  /** POST /api/v1/transfer-requests/:id/{accept|decline|cancel} */
  resolve(action: 'accept' | 'cancel' | 'decline') {
    return (c: Context) =>
      this.run(c, async () => {
        const { id } = this.getParams<TransferRequestIdParam>(c);
        return this.success(c, await (await this.service(c))[action](id));
      });
  }
}
