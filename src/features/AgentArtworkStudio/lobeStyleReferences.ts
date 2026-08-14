import type { AgentArtworkStyle } from '@lobechat/prompts';

import { CHIEF_AGENT_ARTWORKS } from '@/features/ChiefAgent/artwork';

/**
 * Three hue-diverse official mascots. Enough images to pin the rendering
 * style, while the variety keeps the model from copying one character
 * instead of inventing a subject for the agent.
 */
const REFERENCE_IDS = new Set(['lobe', 'byte', 'buttercup']);

export const LOBE_STYLE_REFERENCE_IMAGE_URLS = CHIEF_AGENT_ARTWORKS.filter((item) =>
  REFERENCE_IDS.has(item.id),
).map((item) => item.avatar);

export const styleReferencesForArtworkStyle = (style: AgentArtworkStyle): string[] | undefined =>
  style === 'lobe' ? LOBE_STYLE_REFERENCE_IMAGE_URLS : undefined;
