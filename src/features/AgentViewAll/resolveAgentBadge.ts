import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { SidebarAgentItem } from '@lobechat/types';

import { usableBackground } from '@/components/Avatar/fallback';

const BUILTIN_SLUGS = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Labels that mark an event / limited-time agent. Only these earn the arch
 * badge above the avatar — regular agents stay clean.
 */
const EVENT_LABEL_PATTERN = /\b(?:hackathons?|events?|limited)\b|限定|活动/i;

export type AgentBottomPendant = 'core' | 'official';

export interface AgentTopPendant {
  color?: string | null;
  label: string;
}

export interface AgentBadge {
  /** Short identity chip pinned to the avatar's bottom edge. */
  bottom?: AgentBottomPendant;
  /** Cover band color; absent renders the plain (avatar-only) badge. */
  cover?: string;
  /** Arch badge above the avatar, reserved for event / limited agents. */
  top?: AgentTopPendant;
}

/**
 * Data-driven badge decorations for the agent list's badge wall. Most agents
 * resolve to nothing, so the wall doesn't turn into a sticker board:
 * - cover: only agents that picked a real (non-transparent) avatar background color;
 * - bottom chip: builtin agents read "official", pinned agents read "core";
 * - top arch: only agents carrying an event / limited label.
 */
export const resolveAgentBadge = (item: SidebarAgentItem): AgentBadge => {
  const badge: AgentBadge = {};

  // The swatch picker's "default" entry stores a transparent color, which means
  // "no color chosen" — same rule as the avatar fallback.
  const cover = usableBackground(item.backgroundColor);
  if (cover) badge.cover = cover;

  if (item.slug && BUILTIN_SLUGS.has(item.slug)) badge.bottom = 'official';
  else if (item.pinned) badge.bottom = 'core';

  const eventLabel = item.labels?.find((label) => EVENT_LABEL_PATTERN.test(label.name));
  if (eventLabel) badge.top = { color: eventLabel.color, label: eventLabel.name };

  return badge;
};
