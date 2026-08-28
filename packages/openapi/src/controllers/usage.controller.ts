import type { Context } from 'hono';

import { getOpenApiUsage } from '@/business/server/openapiUsage';

import { BaseController } from '../common/base.controller';

export class UsageController extends BaseController {
  async getUsage(c: Context) {
    try {
      const result = await getOpenApiUsage({
        userId: this.getUserId(c)!,
        workspaceId: this.getWorkspaceId(c),
      });
      return this.success(c, result, 'Usage and quota retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
