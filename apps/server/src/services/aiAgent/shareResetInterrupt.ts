import type { LobeChatDatabase } from '@/database/type';
import { createOwnerPrincipal } from '@/server/services/executionPrincipal';
import { after } from '@/server/utils/scheduleAfterResponse';

/**
 * Build an `onShareReset` callback for `writeAgentConfigWithShareReset`
 * writers (`AgentModel.update` / `AgentModel.updateConfig` /
 * `SessionModel.updateConfig`) that schedules
 * `AiAgentService.interruptActiveShareRuns` after the triggering write
 * commits.
 *
 * WHY every config writer needs this, not just the dedicated Agent Share
 * endpoints: `writeAgentConfigWithShareReset` resets a non-private share back
 * to `private` whenever a write turns the agent heterogeneous (Codex / Claude
 * Code) — reachable from the web UI's agent settings, the Agent Builder tool,
 * the legacy session-config endpoint, and the OpenAPI `PATCH
 * /api/v1/agents/:id`. Resetting the row blocks NEW visitor requests, but an
 * operation the visitor already started keeps running with the OLD config
 * snapshot and the creator's credentials/budget, and the visitor can no
 * longer stop it (`shareChat.interruptTask` re-checks visibility and gets
 * `FORBIDDEN`) — the exact bug class `agentShareRouter.disableShare` /
 * `updateVisibility` already close for EXPLICIT revocation. `writeAgentConfigWithShareReset`
 * lives in `packages/database` and cannot import `AiAgentService`
 * (apps/server), so every caller that CAN reach the server layer must build
 * and pass this callback down through `AgentModel`/`SessionModel`'s
 * constructor options instead.
 *
 * Deliberately constructs `AiAgentService` WITHOUT a `workspaceId`: this
 * callback fires post-commit, arbitrarily long after the write that triggered
 * it, so the caller's OWN scope at write time (`AgentModel.transferAgents` /
 * `AgentGroupRepository.transferToWorkspace` fire this from inside a scope
 * change) is already the wrong thing to remember. `interruptActiveShareRuns`
 * is workspace-independent by design instead:
 * `TopicModel.findActiveVisitorRunTopics` matches on `topics.agentId` alone.
 * `agentId` is the one identity that survives any number of transfers, so a
 * `workspaceId` was never actually load-bearing for this path.
 *
 * This is a ONE-SHOT sweep, not a durable cutoff — see
 * `AiAgentService.interruptActiveShareRuns`'s JSDoc for the accepted tradeoff
 * (a run still standing up when this fires can escape it).
 */
export const scheduleShareRunInterruptOnReset =
  (serverDB: LobeChatDatabase, ownerId: string) =>
  (agentId: string): void => {
    after(async () => {
      // Dynamic import, not a static one: `services/agent/index.ts` (one of
      // this callback's callers) is itself imported by `./index.ts`
      // (`AiAgentService` constructs an `AgentService` internally), so a
      // static import here would create a module-load cycle. Deferring
      // resolution to call time (well after both modules have finished
      // loading) breaks it without changing behavior.
      const { AiAgentService } = await import('.');

      await new AiAgentService(serverDB, createOwnerPrincipal(ownerId))
        .interruptActiveShareRuns(agentId)
        .catch((error) =>
          console.error('[agentConfigShareReset] interruptActiveShareRuns failed', error),
        );
    });
  };
