import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { SidebarAgentItem } from '@lobechat/types';

import { usableBackground } from '@/components/Avatar/fallback';
import { resolveAgentBackground } from '@/features/AgentProfileArtwork/utils';

const BUILTIN_SLUGS = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Labels that mark an event / limited-time agent. Only these earn the arch
 * badge above the avatar — regular agents stay clean.
 */
const EVENT_LABEL_PATTERN = /\b(?:hackathons?|events?|limited)\b|限定|活动/i;

export type AgentBottomPendant = 'official';

export interface AgentTopPendant {
  color?: string | null;
  label: string;
}

export interface AgentBadge {
  /** Short identity chip pinned to the avatar's bottom edge. */
  bottom?: AgentBottomPendant;
  /** Cover color the agent picked; absent lets the card derive one from the avatar. */
  cover?: string;
  /** Profile cover image the agent uploaded; shown as-is instead of a tinted band. */
  coverImage?: string;
  /** Arch badge above the avatar, reserved for event / limited agents. */
  top?: AgentTopPendant;
}

/**
 * Data-driven badge decorations for the agent list's badge wall. Most agents
 * resolve to nothing, so the wall doesn't turn into a sticker board:
 * - cover: the profile cover image, else the background color the agent picked;
 * - bottom chip: only builtin agents, reading "official";
 * - top arch: only agents carrying an event / limited label.
 */
export const resolveAgentBadge = (item: SidebarAgentItem): AgentBadge => {
  const badge: AgentBadge = {};

  // `backgroundColor` now stores the profile cover image (see
  // resolveAgentBackground); only legacy rows still hold a color. The swatch
  // picker's "default" entry stores a transparent color, which means "no color
  // chosen" — same rule as the avatar fallback.
  const coverImage = resolveAgentBackground(item.backgroundColor);
  if (coverImage) badge.coverImage = coverImage;
  else {
    const cover = usableBackground(item.backgroundColor);
    if (cover) badge.cover = cover;
  }

  if (item.slug && BUILTIN_SLUGS.has(item.slug)) badge.bottom = 'official';

  const eventLabel = item.labels?.find((label) => EVENT_LABEL_PATTERN.test(label.name));
  if (eventLabel) badge.top = { color: eventLabel.color, label: eventLabel.name };

  return badge;
};
