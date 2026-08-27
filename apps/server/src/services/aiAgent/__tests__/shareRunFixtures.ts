import type { AgentShareConfig } from '@/database/schemas';
import type { AgentShareGate } from '@/server/services/aiAgent/shareGate';
import { createDelegatedPrincipal } from '@/server/services/executionPrincipal';

/**
 * The two halves of a share run, kept in one place so a test cannot express a
 * combination production never produces.
 *
 * `AiAgentService.execAgent` fails closed when its principal and its
 * `shareGate` disagree about who is driving the run — the gateway JWT is signed
 * for the principal's actor, so an OWNER principal on a share run would hand
 * the visitor a creator-signed token. `shareChat.ts` derives both from the same
 * share record; these fixtures do the same for tests.
 */
export const SHARE_VISITOR_ID = 'visitor-1';
export const SHARE_ID = 'share-1';

/**
 * The per-call authorization snapshot, as `shareChat.ts` builds it.
 *
 * `shareConfig` is a `Partial` cast to the full type: each suite only sets the
 * few fields its own assertions depend on, and widening the real type to make
 * that legal would weaken it for production callers.
 */
export const buildShareGate = (params: {
  agentId: string;
  shareConfig?: Partial<AgentShareConfig>;
}): Omit<AgentShareGate, 'generation'> => ({
  agentId: params.agentId,
  shareConfig: (params.shareConfig ?? {}) as AgentShareConfig,
  shareId: SHARE_ID,
  visitorUserId: SHARE_VISITOR_ID,
});

/**
 * The identity that MUST accompany {@link buildShareGate}: the visitor acts,
 * the creator owns everything the run touches.
 */
export const buildSharePrincipal = (params: {
  agentId: string;
  ownerUserId: string;
  shareConfig?: Partial<AgentShareConfig>;
}) =>
  createDelegatedPrincipal({
    actorUserId: SHARE_VISITOR_ID,
    delegation: {
      agentId: params.agentId,
      grants: {
        allowReadMemory: params.shareConfig?.allowReadMemory,
        enabledToolIds: params.shareConfig?.enabledToolIds,
      },
      shareId: SHARE_ID,
    },
    resourceOwnerUserId: params.ownerUserId,
  });
