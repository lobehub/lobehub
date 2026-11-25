import type { ShareVisibility } from '../topic';
import type { CollectionWorkVersionMetadata, WorkItem } from '../work';

/**
 * An Agent share's reach. `private` pauses it for everyone but the owner. `card` admits only the
 * people the owner granted it to by sharing the Agent's card into a Channel; its link page stays
 * closed. `link` opens it to anyone signed in with the link, card grantees included.
 */
export type AgentShareVisibility = ShareVisibility | 'card';

/** A share that admits someone besides its owner: by link, or by an owner's card. */
export const isLiveAgentShareVisibility = (visibility: string | null | undefined) =>
  visibility === 'link' || visibility === 'card';

/**
 * Where an Agent share grant came from: the owner's card message the grantee added it from, or
 * the owner approving the grantee's request to use the Agent (`channel_agent_grants` row).
 */
export type AgentShareGrantSource =
  | { channelId: string; messageId: string; type: 'card' }
  | { channelId: string; grantId: string; type: 'request' };

/** A person the owner granted a `card` share to, for the owner's share settings. */
export interface AgentShareGrantItem {
  createdAt: Date;
  user: {
    avatar: string | null;
    fullName: string | null;
    id: string;
    username: string | null;
  };
}

/** A creator-authored visitor task, independent of the agent's opening questions. */
export interface AgentShareDemoCase {
  description: string;
  /** Displayed as the example task and carried into the visitor's conversation draft. */
  prompt: string;
}

/** Explicit public projection: no conversation, message, owner, or tool provenance. */
export type SharedAgentWork = Pick<
  WorkItem,
  | 'createdAt'
  | 'description'
  | 'id'
  | 'identifier'
  | 'resourceType'
  | 'status'
  | 'title'
  | 'type'
  | 'updatedAt'
  | 'url'
> & {
  /** A collection Work's images, so its card shows the count and opens the grid; `url` is the cover. */
  collection?: CollectionWorkVersionMetadata;
  totalCost: number | null;
};

/** Creator-side delivery aggregates; selection for the showcase does not change the sample. */
export interface SharedAgentDeliveryStats {
  /** Mean elapsed seconds across finished operations with valid timestamps. */
  averageOperationDurationSeconds: number | null;
  /** Mean measured Work cost; cumulative versions from one operation are not added twice. */
  averageWorkCost: number | null;
  lastDeliveredAt: Date | null;
  workCount: number;
}

/**
 * The share's own rules, restated for the visitor BEFORE they invest in a
 * conversation. Every value here already governs the runtime; the profile
 * surface exists so the visitor learns them up front instead of by hitting
 * an error mid-chat.
 */
export interface SharedAgentTerms {
  /** Whether the creator opted into reading visitor conversations. */
  allowCreatorViewSessions: boolean;
  /**
   * Total upload space (bytes) the creator opened to visitor attachments on
   * this share; `0` means attachments are off and the composer hides them.
   */
  maxFileStorage: number;
  /** Messages this visitor may send to the share in total. */
  maxMessagesPerVisitor: number;
}

/**
 * Aggregate reach of the share. `views` is a raw page-view counter (not
 * deduplicated); `visitors` and `conversations` come from the share's topics.
 */
export interface SharedAgentStats extends SharedAgentDeliveryStats {
  conversations: number;
  views: number;
  visitors: number;
}

/** Agent metadata exposed to visitors of an agent share, including signed-out ones. */
export interface SharedAgentUploadAbility {
  audio: boolean;
  image: boolean;
  video: boolean;
}

export interface SharedAgentData {
  agentId: string;
  agentMeta: {
    avatar: string | null;
    backgroundColor: string | null;
    description: string | null;
    name: string | null;
    /**
     * Creator-authored starter prompts. The owner-facing surface has always
     * had these; the visitor profile is the first place they reach the person
     * who actually needs the hint.
     */
    openingQuestions: string[];
    /** Free-form labels from `agents.tags`. */
    tags: string[];
    title: string | null;
  };
  /** Who funds visitor execution, without exposing the owning Workspace id. */
  billingScope: 'personal' | 'workspace';
  /**
   * Who published this share. In a market of user-made agents the creator is
   * the quality signal a visitor has before any usage number exists.
   */
  creator: {
    avatar: string | null;
    name: string | null;
  };
  demoCases: AgentShareDemoCase[];
  featuredWorks: SharedAgentWork[];
  /**
   * True when the requesting user (`ctx.userId`) is the creator of the
   * shared agent — lets the client render owner-only affordances (e.g. an
   * "edit share" link) instead of the plain visitor UI.
   */
  isOwner: boolean;
  /**
   * Slug of the Workspace that owns a Workspace share, returned only to its
   * owner so the "settings" link can open the share inside that Workspace
   * rather than the active one. Always `null` for visitors and personal shares.
   */
  ownerWorkspaceSlug: string | null;
  shareId: string;
  /** The share's custom URL slug, if the creator has set one. `null` otherwise. */
  slug: string | null;
  stats: SharedAgentStats;
  terms: SharedAgentTerms;
  /**
   * Identifiers of the tools the creator opened to visitors. Identifiers only
   * — never the granted API list, which is owner-facing configuration.
   */
  toolGrants: string[];
  /**
   * Which media the visitor composer may attach, derived server-side from
   * the agent's model abilities so the model itself, which is
   * owner-facing, stays hidden. Documents are always allowed; these only gate
   * direct media input.
   */
  uploadAbility: SharedAgentUploadAbility;
  visibility: AgentShareVisibility;
}

/**
 * One tool the creator granted to share visitors.
 *
 * Lives in `@lobechat/types` (rather than next to the other agent-share
 * helpers in `@lobechat/const`) because both `@lobechat/const` and
 * `@lobechat/types`' own `AgentShareVisitorContext` need it, and `const`
 * already depends on `types` — the reverse direction would be a cycle.
 */
export interface AgentShareToolGrant {
  /**
   * Granted API names. Omitted = every API the tool offers (still subject to
   * the runtime visitor gates). Never an empty array — a tool with no granted
   * API is simply absent from the list.
   */
  apis?: string[];
  identifier: string;
}
