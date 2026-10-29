import { BRANDING_INBOX_TITLE, BRANDING_LOGO_URL } from '@lobechat/business-const';
import type { MetaData } from '@lobechat/types';

export const DEFAULT_AVATAR = '/avatars/agent-default.png';
export const DEFAULT_USER_AVATAR = '😀';
export const DEFAULT_SUPERVISOR_AVATAR = '🎙️';
export const DEFAULT_SUPERVISOR_ID = 'supervisor';
export const DEFAULT_BACKGROUND_COLOR = undefined;
export const DEFAULT_AGENT_META: MetaData = {};
export const DEFAULT_INBOX_TITLE = BRANDING_INBOX_TITLE;
export const DEFAULT_INBOX_AVATAR = BRANDING_LOGO_URL || '/avatars/lobe-ai.png';
export const DEFAULT_USER_AVATAR_URL = BRANDING_LOGO_URL || '/app-icons/icon-192x192.png';

/**
 * Avatars for the remaining built-in agents.
 *
 * `/avatars/*.png` are drawings of the LobeHub mascot, and the agents that use
 * them referenced those paths as literals — so they kept the upstream character
 * on a distribution that had rebranded everything else, including the agents
 * sitting next to them in the same picker. Routing them through the same slot as
 * DEFAULT_INBOX_AVATAR is what makes the branding complete rather than partial.
 *
 * Upstream is unaffected: BRANDING_LOGO_URL is empty there, so the fallback
 * keeps each agent's own artwork.
 */
export const DEFAULT_AGENT_BUILDER_AVATAR = BRANDING_LOGO_URL || '/avatars/agent-builder.png';
export const DEFAULT_PAGE_AGENT_AVATAR = BRANDING_LOGO_URL || '/avatars/doc-copilot.png';
