import pMap from 'p-map';

import { McpInvocationModel } from '@/database/models/mcpInvocation';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeService } from '@/server/services/agentRuntime';

import { expireClientMcpStep } from './clientStep';
import { expireMcpElicitation } from './expire';
import { recoverMcpElicitationResume } from './queue';

/** Persisted rows own recovery; this timer carries neither responses nor invocation promises. */
export async function recoverPersistedMcpWork(db: LobeChatDatabase) {
  const work = await McpInvocationModel.recoveryWork(db);
  const outcomes = await Promise.allSettled([
    pMap(
      work.interactions,
      async (item) => {
        const runtime = new AgentRuntimeService(db, item.userId, {
          workspaceId: item.workspaceId ?? undefined,
        });
        const service = runtime.createMcpElicitationService();
        if (item.deadline.getTime() > Date.now())
          await recoverMcpElicitationResume(service, item.itemId);
        else
          await expireMcpElicitation(service, item.itemId, runtime.getMcpElicitationRuntime(), {
            rearm: false,
          });
      },
      { concurrency: 5, stopOnError: false },
    ),
    pMap(
      work.clients,
      async (item) => {
        const runtime = new AgentRuntimeService(db, item.userId, {
          workspaceId: item.workspaceId ?? undefined,
        });
        await expireClientMcpStep(runtime.createMcpElicitationService(), item.operationId);
      },
      { concurrency: 5, stopOnError: false },
    ),
  ]);
  const errors = outcomes.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (errors.length) throw new AggregateError(errors, 'MCP recovery failed');
}

let started = false;
export function startMcpRecoveryWorker(db: LobeChatDatabase) {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await recoverPersistedMcpWork(db);
    } catch (error) {
      console.error('[MCP recovery] Failed to recover persisted work', error);
    } finally {
      setTimeout(() => void tick(), 15_000).unref();
    }
  };
  void tick();
}
