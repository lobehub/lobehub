import type { ISandboxService } from '@lobechat/builtin-tool-cloud-sandbox';

import { createPageSessions } from '@/server/services/pageCollab';
import { withPageSync } from '@/server/services/pageCollab/sandboxSync';

import type { ToolExecutionContext } from '../types';

export type SandboxWrapper = (service: ISandboxService) => ISandboxService;

/**
 * @param workspaceId The run's resolved workspace; `context.workspaceId` is empty
 *   on most dispatch paths (see `resolveContentWorkspaceId`).
 */
export const pageSandboxWrapper = (
  context: ToolExecutionContext,
  workspaceId = context.workspaceId,
): SandboxWrapper | undefined => {
  const { agentId, documentId, operationId, rootOperationId, scope, serverDB, userId } = context;
  if (scope !== 'page' || !documentId || !serverDB || !userId) return undefined;

  return (service) =>
    withPageSync(service, {
      documentId,
      sessions: createPageSessions(serverDB, {
        agentId,
        operationId: rootOperationId ?? operationId,
        saveSource: 'llm_call',
        userId,
        workspaceId,
      }),
    });
};
