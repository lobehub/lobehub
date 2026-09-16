import type { ShareVisibility } from '../topic';

/**
 * The share's own rules, restated for the visitor BEFORE they invest in a
 * conversation. Every value here already governs the runtime; the profile
 * surface exists so the visitor learns them up front instead of by hitting
 * an error mid-chat.
 */
export interface SharedAgentTerms {
  /** Whether the creator opted into reading visitor conversations. */
  allowCreatorViewSessions: boolean;
  /** Maximum conversations this visitor may open against the share. */
  maxTopicsPerVisitor: number;
  /** Maximum message turns allowed inside one shared conversation. */
  maxTurnsPerTopic: number;
}

/**
 * Aggregate reach of the share. `views` is a raw page-view counter (not
 * deduplicated); `visitors` and `conversations` come from the share's topics.
 */
export interface SharedAgentStats {
  conversations: number;
  views: number;
  visitors: number;
}

/** Agent metadata exposed to signed-in visitors of an agent share. */
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
  /**
   * Who published this share. In a market of user-made agents the creator is
   * the quality signal a visitor has before any usage number exists.
   */
  creator: {
    avatar: string | null;
    name: string | null;
  };
  /**
   * True when the requesting user (`ctx.userId`) is the creator of the
   * shared agent — lets the client render owner-only affordances (e.g. an
   * "edit share" link) instead of the plain visitor UI.
   */
  isOwner: boolean;
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
  visibility: ShareVisibility;
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
