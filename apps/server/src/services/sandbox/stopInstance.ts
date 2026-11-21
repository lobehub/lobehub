import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import { AgentOperationModel } from '@/database/models/agentOperation';
import type { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import { TopicModel } from '@/database/models/topic';
import { AgentRuntimeService } from '@/server/services/agentRuntime/AgentRuntimeService';

import type { SandboxStorageClient } from './storageFiles';

interface StopInstanceOptions {
  client: Pick<SandboxStorageClient, 'prepareStop' | 'readStopTarget' | 'stopInstance'>;
  id: string;
  instanceModel: Pick<EnvironmentInstanceModel, 'findOwnedById'>;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

/** Stop the run before releasing its sandbox, so recovery cannot reacquire it. */
export const stopSandboxInstance = async (options: StopInstanceOptions) => {
  const { client, id, instanceModel, serverDB, userId } = options;
  const workspaceId = options.workspaceId ?? undefined;
  // Being a workspace member is not authority to stop every member's copies.
  if (!(await instanceModel.findOwnedById(id))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment instance not found' });
  }

  const target = await client.readStopTarget({ name: id });
  if (!target) return { stopped: false };

  let operationIds: string[] = [];
  if (target.topicId) {
    // The execution plane proves which topic holds this copy. Never accept a
    // topic/operation from the UI or infer it from historical session rows.
    const topic = await new TopicModel(serverDB, userId, workspaceId).findById(target.topicId);
    if (!topic) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot resolve the holding conversation',
      });
    }
    const model = new AgentOperationModel(serverDB, userId, workspaceId);
    const operations = await model.findLiveByTopic(topic.id);
    operationIds = operations.map((operation) => operation.id);
    if (operations.some((op) => op.topicId !== topic.id)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Cannot resolve the holding operation' });
    }

    // Recheck after DB IO. A stop prepared for one holder must not interrupt a
    // different topic that acquired the instance while the lookup was pending.
    const current = await client.readStopTarget({ name: id });
    if (current?.sessionId !== target.sessionId || current.topicId !== target.topicId) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Environment instance holder changed' });
    }
    // Persist cancellation before interruption can make a live row terminal.
    // The fence survives retries even when the next query no longer returns it.
    const prepared = await client.prepareStop({
      expectedSessionId: target.sessionId,
      name: id,
      operationIds,
    });
    if (!prepared.prepared) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Environment instance holder changed' });
    }
    for (const operation of operations) {
      // Shared topics may run as another member. Use the scoped operation row's
      // actor, never the execution plane's organization-level session identity.
      const runtime = new AgentRuntimeService(serverDB, operation.userId, { workspaceId });
      if (!(await runtime.interruptOperation(operation.id))) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Agent interruption could not be confirmed',
        });
      }
    }
  }

  const result = await client.stopInstance({
    expectedSessionId: target.sessionId,
    name: id,
    operationIds,
  });
  if (!result.stopped) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Environment instance holder changed' });
  }
  return result;
};
