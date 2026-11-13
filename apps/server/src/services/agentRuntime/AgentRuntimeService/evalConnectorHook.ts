import type { ToolCallHookEvent } from '@lobechat/agent-runtime';
import type { LobeChatDatabase } from '@lobechat/database';
import type { EvalConnectorSnapshots } from '@lobechat/types';
import debug from 'debug';

import {
  AgentEvalConnectorService,
  getEvalConnectorDatasetId,
} from '@/server/services/agentEvalConnector';

import type { AgentHook } from '../hooks';

const log = debug('lobe-server:eval-connector-hook');

export const EVAL_CONNECTOR_HOOK_ID = 'eval-connector-bindings';

/** Credentials stay in connection storage and are resolved afresh for each call. */
export const createEvalConnectorHook = (
  deps: { db: LobeChatDatabase; userId: string; workspaceId?: string },
  snapshots: EvalConnectorSnapshots,
  context: { attemptId?: string; caseId?: string; legacyIdentifiers?: string[] },
): AgentHook => ({
  handler: async (event) => {
    const { apiName, args, callIndex, identifier, mock, operationId, stepIndex } =
      event as unknown as ToolCallHookEvent;
    if (!Object.hasOwn(snapshots, identifier)) {
      if (context.legacyIdentifiers?.includes(identifier)) {
        mock({
          content: 'The tool connection is unavailable.',
          success: false,
        });
      }
      return;
    }
    try {
      const service = new AgentEvalConnectorService(
        deps.db,
        deps.userId,
        getEvalConnectorDatasetId(snapshots),
        deps.workspaceId,
      );
      const result = await service.execute(identifier, snapshots, {
        apiName,
        args: typeof args === 'string' ? args : JSON.stringify(args),
        attemptId: context.attemptId,
        callIndex,
        caseId: context.caseId,
        operationId,
        stepIndex,
      });
      mock(result);
    } catch (error) {
      log(
        'call failed connector=%s case=%s api=%s errorType=%s',
        snapshots[identifier]?.connectorId,
        context.caseId,
        apiName,
        error instanceof Error ? error.name : typeof error,
      );
      // Provider errors can contain URLs and headers; expose only our safe diagnostics.
      mock({
        content: 'The tool connection is unavailable. Please try again later.',
        success: false,
      });
    }
  },
  id: EVAL_CONNECTOR_HOOK_ID,
  type: 'beforeToolCall',
});
