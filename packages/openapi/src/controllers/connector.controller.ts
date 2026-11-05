import type { Context } from 'hono';
import type { z } from 'zod';

import { createPersonalConnectorService } from '@/server/services/personalConnector/createService';

import { BaseController } from '../common/base.controller';
import type {
  ConnectorAgentScopeSchema,
  ConnectorAuthorizeSchema,
  ConnectorDisconnectSchema,
} from '../types/connector.type';

export class ConnectorController extends BaseController {
  private async service(c: Context) {
    return createPersonalConnectorService(await this.getDatabase(), this.getUserId(c)!, {
      workspaceId: this.getWorkspaceId(c),
    });
  }

  async execute(
    c: Context,
    action:
      | 'catalog'
      | 'list'
      | 'get'
      | 'refresh'
      | 'authorize'
      | 'reconcile'
      | 'cancel'
      | 'agents'
      | 'disconnect',
  ) {
    try {
      const service = await this.service(c);
      const { id, sessionId } = c.req.param();
      let data: unknown;
      switch (action) {
        case 'catalog': {
          data = service.catalog();
          break;
        }
        case 'list': {
          data = await service.list();
          break;
        }
        case 'get': {
          data = await service.get(id);
          break;
        }
        case 'refresh': {
          data = await service.refresh(id);
          break;
        }
        case 'authorize': {
          data = await service.authorize(
            (await this.getBody<z.infer<typeof ConnectorAuthorizeSchema>>(c))!,
          );
          break;
        }
        case 'reconcile': {
          data = await service.reconcile(sessionId);
          break;
        }
        case 'cancel': {
          data = await service.reconcile(sessionId, true);
          break;
        }
        case 'agents': {
          const body = (await this.getBody<z.infer<typeof ConnectorAgentScopeSchema>>(c))!;
          data = await service.setAgents(
            id,
            body.agentIds,
            body.revision,
            body.adoptReadOnly,
            body.replacements,
          );
          break;
        }
        case 'disconnect': {
          const body = (await this.getBody<z.infer<typeof ConnectorDisconnectSchema>>(c))!;
          data = await service.disconnect(id, body.revision);
          break;
        }
      }
      return this.success(c, data);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
