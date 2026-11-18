import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { buildFrameAncestorsDirective } from '@lobechat/embed/origin';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentShareModel } from '@/database/models/agentShare';
import type { LobeChatDatabase } from '@/database/type';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

const log = debug('lobe-server:agent-share:embed');

/**
 * Origins allowed to frame the embed page of a share, or `[]` when none may.
 *
 * Fails closed on every branch: a deployment without Agent Share, an unknown
 * or paused share, an empty allowlist, a creator outside the `agent_embed`
 * rollout, or any lookup error all forbid framing. The flag is read for the
 * share's CREATOR — the visitor's own rollout never widens who may embed.
 */
export const resolveAgentEmbedOrigins = async (
  slugOrId: string,
  db?: LobeChatDatabase,
): Promise<string[]> => {
  if (!ENABLE_BUSINESS_FEATURES || !slugOrId) return [];

  try {
    const share = await AgentShareModel.findBySlugOrId(db ?? (await getServerDB()), slugOrId);
    if (!share || share.visibility !== 'link') return [];

    const origins = share.shareConfig.embedAllowedOrigins ?? [];
    if (origins.length === 0) return [];

    const flags = await getServerFeatureFlagsStateFromRuntimeConfig(share.ownerId ?? undefined);
    if (flags.enableAgentEmbed !== true) return [];

    return origins;
  } catch (error) {
    log('Failed to resolve embed origins for %s: %O', slugOrId, error);
    return [];
  }
};

/** The `Content-Security-Policy` value of a share's embed page. */
export const resolveAgentEmbedFrameAncestors = async (slugOrId: string, db?: LobeChatDatabase) =>
  buildFrameAncestorsDirective(await resolveAgentEmbedOrigins(slugOrId, db));
