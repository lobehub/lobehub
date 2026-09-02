import type { ShareVisibility } from '../topic';

/** Agent metadata exposed to signed-in visitors of an agent share. */
export interface SharedAgentData {
  agentId: string;
  agentMeta: {
    avatar: string | null;
    backgroundColor: string | null;
    description: string | null;
    name: string | null;
    title: string | null;
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
