import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import type { AgentShareGate } from '@/server/services/aiAgent/shareGate';

import { type AgentInterventionDispatchContext } from '../aiAgent';
import type { resolveLinkShareOrThrow } from './guards';

type LinkShare = Awaited<ReturnType<typeof resolveLinkShareOrThrow>>;

/**
 * Everything a share VISITOR run executes with: the creator-scoped service and
 * models (the run's rows are written under the creator's identity) plus the
 * `shareGate` that strips whatever the share config does not grant.
 *
 * Built fresh from the live share row on every call — a fresh turn and an
 * intervention continuation alike — so a continuation is gated by the share's
 * CURRENT config, never by a snapshot taken when the run parked.
 */
export const createShareRunScope = async (
  db: LobeChatDatabase,
  share: LinkShare,
  visitorUserId: string,
) => {
  const workspaceId = share.workspaceId ?? undefined;
  const modelOptions = { includeShareVisitor: true } as const;
  const topicModel = new TopicModel(db, share.ownerId, workspaceId, undefined, modelOptions);
  const messageModel = new MessageModel(db, share.ownerId, workspaceId, undefined, modelOptions);

  const shareGate: AgentShareGate = {
    agentId: share.agentId,
    shareConfig: share.shareConfig,
    // See `AgentShareGate.shareId`'s JSDoc — the share instance this run is
    // authorized against, and the token every later revalidation compares.
    shareId: share.shareId,
    visitorUserId,
  };

  // Creator's Market access token, mirroring aiAgentProcedure — the
  // server-side tool runtime authenticates against the Market API with it.
  let marketAccessToken: string | undefined;
  if (!share.workspaceId) {
    try {
      const userModel = new UserModel(db, share.ownerId);
      const settings = await userModel.getUserSettings();
      marketAccessToken = (settings?.market as any)?.accessToken;
    } catch {
      // non-fatal — MarketService falls back to trustedClientToken
    }
  }

  const aiAgentService = new AiAgentService(db, share.ownerId, {
    // Share visitor turns persist under the creator's `userId` — the
    // service's internal `messageModel`/`topicModel`/runtime must be
    // constructed with the visitor scope so reads/writes on
    // `topics.senderId <> NULL` rows aren't filtered out.
    includeShareVisitor: true,
    marketAccessToken,
    workspaceId,
  });

  /**
   * Dispatch context for an intervention the VISITOR resolved: the actor is
   * the visitor, the continuation runs as the creator under `shareGate`.
   */
  const dispatchContext: AgentInterventionDispatchContext = {
    aiAgentService,
    serverDB: db,
    shareGate,
    userId: visitorUserId,
    workspaceId: share.workspaceId,
  };

  return { aiAgentService, dispatchContext, messageModel, shareGate, topicModel };
};
