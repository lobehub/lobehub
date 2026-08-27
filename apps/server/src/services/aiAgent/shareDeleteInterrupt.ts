import type { ActiveShareRun } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { createOwnerPrincipal } from '@/server/services/executionPrincipal';
import { after } from '@/server/utils/scheduleAfterResponse';

/**
 * Build an `onShareRunsInterrupted` callback for `AgentModel.delete()` (and
 * any sibling delete path that snapshots the same way, e.g.
 * `SessionModel`'s orphan-agent cleanup) that schedules
 * `AiAgentService.interruptTask` for every snapshotted Agent Share visitor
 * run after the deleting transaction commits.
 *
 * WHY this cannot just re-query and call `AiAgentService
 * .interruptActiveShareRuns(agentId, revocationGeneration)` like the
 * reset-path sibling
 * (`scheduleShareRunInterruptOnReset`): resetting a share leaves the agent
 * and its topic rows in place, so re-querying them post-commit still finds
 * the same runs. Deleting the agent CASCADES those topic rows away in the
 * same transaction (`topics.agentId` -> `agents.id`), so by the time this
 * runs post-commit there is nothing left to re-discover — the caller must
 * snapshot `TopicModel.findActiveVisitorRunTopics` BEFORE the delete (see
 * `AgentModel.delete`) and hand the list straight through here instead.
 */
export const interruptSnapshottedShareRuns =
  (serverDB: LobeChatDatabase, ownerId: string) =>
  (activeShareRuns: ActiveShareRun[]): void => {
    if (activeShareRuns.length === 0) return;

    after(async () => {
      // Dynamic import, not a static one: some callers of this helper (e.g.
      // the Agent Management tool runtime) are themselves reachable from
      // `AiAgentService`'s own construction path, so a static import here
      // would create a module-load cycle — same reasoning as
      // `scheduleShareRunInterruptOnReset`. Deferring resolution to call
      // time (well after both modules have finished loading) breaks it
      // without changing behavior.
      const { AiAgentService } = await import('.');
      const aiAgentService = new AiAgentService(serverDB, createOwnerPrincipal(ownerId));

      await Promise.all(
        activeShareRuns.map(({ operationId }) =>
          aiAgentService
            .interruptTask({ operationId })
            .catch((error) => console.error('[shareDeleteInterrupt] interruptTask failed', error)),
        ),
      );
    });
  };
