import type { LobeChatDatabase } from '@/database/type';
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
 * constructor options instead. See LOBE-11930 hole 2.
 *
 * Deliberately constructs `AiAgentService` WITHOUT a `workspaceId`: this
 * callback fires post-commit, arbitrarily long after the write that produced
 * `revocationGeneration`, so the caller's OWN scope at write time (`AgentModel
 * .transferAgents` / `AgentGroupRepository.transferToWorkspace` fire this from
 * inside a scope change) is already the wrong thing to remember. An earlier
 * version threaded the transfer's destination workspace through here so
 * `interruptActiveShareRuns`'s `TopicModel` re-query could be scoped to it —
 * that broke the moment a SECOND transfer landed before this callback ran:
 * the topic moves again, but the second transfer schedules no callback of its
 * own (the share is already `private` after the first move, so its own
 * `ne(visibility, 'private')` reset guard finds nothing), leaving the one
 * scheduled callback permanently scoped to a now-stale workspace. Both steps
 * `interruptActiveShareRuns` runs are workspace-independent by design instead:
 * `revokeReservations` matches on `agentShareRunReservations.agentId` (no
 * workspace column exists on that table), and
 * `TopicModel.findActiveVisitorRunTopicsByAgentId` — used here instead of the
 * workspace-scoped `findActiveVisitorRunTopics` — matches on `topics.agentId`
 * alone. `agentId` is the one identity that survives any number of transfers,
 * so a `workspaceId` was never actually load-bearing for this path; passing
 * one in was the accidental coupling that caused this bug class in the first
 * place. See LOBE-11930 (the double-transfer window) and
 * `TopicModel.findActiveVisitorRunTopicsByAgentId`'s JSDoc.
 */
export const scheduleShareRunInterruptOnReset =
  (serverDB: LobeChatDatabase, ownerId: string) =>
  (agentId: string, revocationGeneration: number): void => {
    after(async () => {
      // Dynamic import, not a static one: `services/agent/index.ts` (one of
      // this callback's callers) is itself imported by `./index.ts`
      // (`AiAgentService` constructs an `AgentService` internally), so a
      // static import here would create a module-load cycle. Deferring
      // resolution to call time (well after both modules have finished
      // loading) breaks it without changing behavior.
      const { AiAgentService } = await import('.');

      // `revocationGeneration` was captured by `writeAgentConfigWithShareReset`
      // at write time and threaded straight through — see
      // `interruptActiveShareRuns`'s JSDoc for why it must never be re-read
      // here instead.
      await new AiAgentService(serverDB, ownerId)
        .interruptActiveShareRuns(agentId, revocationGeneration)
        .catch((error) =>
          console.error('[agentConfigShareReset] interruptActiveShareRuns failed', error),
        );
    });
  };
