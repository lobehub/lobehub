import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ToolCallRestService } from '../services/tool-call.service';
import type { ToolCallRequest } from '../types/tool-call.type';

export class ToolCallController extends BaseController {
  async callTool(c: Context) {
    try {
      const db = await this.getDatabase();
      const service = new ToolCallRestService(
        db,
        this.getUserId(c),
        this.getWorkspaceId(c),
        c.get('workspaceRole') || undefined,
      );
      const body = await this.getBody<ToolCallRequest>(c);
      return this.success(c, await service.callTool(body), 'Tool called');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
