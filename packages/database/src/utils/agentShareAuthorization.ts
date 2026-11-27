import type {
  AgentShareAuthorizationChange,
  AgentShareAuthorizationKind,
  AgentShareCapabilitiesAuthorizationSnapshot,
  AgentShareDeviceAccessAuthorizationSnapshot,
  AgentShareDisclosureAuthorizationSnapshot,
  AgentShareVisibilityAuthorizationSnapshot,
} from '@lobechat/types';
import { isLiveAgentShareVisibility } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import type { AgentShareConfig } from '../schemas';

/** The share fields an authorization snapshot is drawn from. */
export interface AgentShareAuthorizationState {
  id: string;
  shareConfig: AgentShareConfig | null;
  visibility: string;
}

/**
 * Which authorization kind covers each share setting; `null` for presentation (slug, demo cases,
 * featured Works, market listing), caps and bookkeeping, which grant visitors nothing. Typed over
 * every setting, so a new one does not compile until it is classified, and
 * `agentShareAuthorization.test.ts` checks a granting setting really reaches its kind's snapshot.
 */
export const AGENT_SHARE_SETTING_AUTHORIZATION_KIND = {
  allowCreatorViewSessions: 'agent_share.disclosure',
  allowReadMemory: 'agent_share.capabilities',
  autoGrantAgentTools: 'agent_share.capabilities',
  declinedGrantIds: 'agent_share.capabilities',
  demoCases: null,
  deviceAccess: 'agent_share.device_access',
  deviceAllowUserIds: 'agent_share.device_access',
  featuredWorkIds: null,
  listedInMarket: null,
  maxFileStorage: null,
  maxMessagesPerVisitor: null,
  monthlySpendLimit: null,
  seedDefaultGrants: null,
  skillGrants: 'agent_share.capabilities',
  slug: null,
  toolGrants: 'agent_share.capabilities',
} as const satisfies Record<
  keyof AgentShareConfig,
  Exclude<AgentShareAuthorizationKind, 'agent_share.person_grant' | 'agent_share.visibility'> | null
>;

const sorted = (values: string[] | undefined) => [...(values ?? [])].sort();

const deviceSnapshot = (
  share: AgentShareAuthorizationState,
): AgentShareDeviceAccessAuthorizationSnapshot => ({
  deviceAccess: share.shareConfig?.deviceAccess ?? 'none',
  deviceAllowUserIds: sorted(share.shareConfig?.deviceAllowUserIds),
  shareId: share.id,
});

const capabilitiesSnapshot = (
  share: AgentShareAuthorizationState,
): AgentShareCapabilitiesAuthorizationSnapshot => {
  const autoGrantAgentTools = share.shareConfig?.autoGrantAgentTools ?? false;

  return {
    allowReadMemory: share.shareConfig?.allowReadMemory ?? false,
    autoGrantAgentTools,
    // A declined identifier only keeps one out of the automatic grants; with those off, declining
    // a "new on this Agent" prompt grants and revokes nothing.
    declinedGrantIds: autoGrantAgentTools ? sorted(share.shareConfig?.declinedGrantIds) : [],
    shareId: share.id,
    skillGrants: sorted(share.shareConfig?.skillGrants),
    toolGrants: [...(share.shareConfig?.toolGrants ?? [])]
      .map((grant) => ({
        identifier: grant.identifier,
        ...(grant.apis && { apis: sorted(grant.apis) }),
      }))
      .sort((a, b) => a.identifier.localeCompare(b.identifier)),
  };
};

const disclosureSnapshot = (
  share: AgentShareAuthorizationState,
): AgentShareDisclosureAuthorizationSnapshot => ({
  allowCreatorViewSessions: share.shareConfig?.allowCreatorViewSessions ?? false,
  shareId: share.id,
});

/**
 * A live share's snapshot carries every grant it holds: grants configured while the share was
 * paused take effect the moment it is published, so publishing grants them too.
 */
const visibilitySnapshot = (
  share: AgentShareAuthorizationState,
): AgentShareVisibilityAuthorizationSnapshot =>
  isLiveAgentShareVisibility(share.visibility)
    ? {
        capabilities: capabilitiesSnapshot(share),
        deviceAccess: deviceSnapshot(share),
        disclosure: disclosureSnapshot(share),
        shareId: share.id,
        visibility: share.visibility,
      }
    : { shareId: share.id, visibility: share.visibility };

const GRANT_SNAPSHOTS = [
  ['agent_share.device_access', deviceSnapshot],
  ['agent_share.capabilities', capabilitiesSnapshot],
  ['agent_share.disclosure', disclosureSnapshot],
] as const;

/**
 * The authorization changes between two states of one Agent's share (`null` = no share row).
 *
 * Only what admits visitors or what they may reach counts
 * ({@link AGENT_SHARE_SETTING_AUTHORIZATION_KIND}). A share that never
 * admitted anyone (missing ↔ `private`) has no visibility change. A replaced share (new id)
 * is the old one removed and a new one created.
 */
export const diffAgentShareAuthorization = (
  before: AgentShareAuthorizationState | null,
  after: AgentShareAuthorizationState | null,
): AgentShareAuthorizationChange[] => {
  if (before && after && before.id !== after.id)
    return [
      ...diffAgentShareAuthorization(before, null),
      ...diffAgentShareAuthorization(null, after),
    ];

  const changes: AgentShareAuthorizationChange[] = [];
  const wasLive = isLiveAgentShareVisibility(before?.visibility);
  const isLive = isLiveAgentShareVisibility(after?.visibility);

  if ((wasLive || isLive) && before?.visibility !== after?.visibility) {
    changes.push({
      after: after ? visibilitySnapshot(after) : null,
      before: before ? visibilitySnapshot(before) : null,
      kind: 'agent_share.visibility',
    });
  }

  // Creating a row stores the defaults and removing one is covered by its visibility change, so
  // grants only change between two states of the same row.
  if (!before || !after) return changes;

  for (const [kind, snapshot] of GRANT_SNAPSHOTS) {
    const from = snapshot(before);
    const to = snapshot(after);
    if (!isEqual(from, to)) changes.push({ after: to, before: from, kind });
  }

  return changes;
};
