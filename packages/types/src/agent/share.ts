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
