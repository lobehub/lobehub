import { escapeXmlAttr, escapeXmlContent } from '../search/xmlEscape';

export type AgentArtworkKind = 'avatar' | 'background';

export const AGENT_ARTWORK_STYLES = [
  'editorial',
  'geometric',
  'clay',
  'watercolor',
  'riso',
  'photographic',
] as const;

export type AgentArtworkStyle = (typeof AGENT_ARTWORK_STYLES)[number];

export const DEFAULT_AGENT_ARTWORK_STYLE: AgentArtworkStyle = 'editorial';

const STYLE_DIRECTIONS: Record<AgentArtworkStyle, string> = {
  clay: 'Render it as a soft 3D clay-style scene with rounded forms, matte materials, gentle studio lighting, and warm pastel colors.',
  editorial:
    'Render it as polished editorial illustration with a calm premium color palette and high contrast.',
  geometric:
    'Render it as flat geometric illustration built from bold simple shapes, crisp edges, and a confident limited palette in the spirit of mid-century poster design.',
  photographic:
    'Render it as a minimalist still-life photograph of tangible objects and materials with soft natural light and a restrained color palette.',
  riso: 'Render it as a retro risograph print with two or three flat ink colors, visible grain, slight misregistration, and bold graphic shapes.',
  watercolor:
    'Render it as a hand-painted watercolor piece with visible paper texture, soft pigment washes, and loose organic edges.',
};

/**
 * Image models collapse "AI agent" semantics into the same starry-space /
 * particle / circuit imagery by default, so every profile ends up looking
 * alike. Steering the motif toward the agent's own domain is what keeps the
 * style presets visually distinct from each other.
 */
const MOTIF_DIRECTION = `Ground the imagery in the agent's specific domain and personality. Avoid generic AI and technology clichés — starry space scenes, glowing particles, circuit boards, neural-network lines, holographic grids — unless the agent's subject matter is explicitly about them.`;

export interface AgentArtworkPromptInput {
  description?: string | null;
  id: string;
  kind: AgentArtworkKind;
  name?: string | null;
  referenceImageUrl?: string | null;
  style?: AgentArtworkStyle | null;
  systemRole?: string | null;
  title?: string | null;
}

const formatAgentContext = ({
  description,
  id,
  name,
  systemRole,
  title,
}: Omit<AgentArtworkPromptInput, 'kind'>): string => {
  const attributes = [`id="${escapeXmlAttr(id)}"`];

  if (name?.trim()) attributes.push(`name="${escapeXmlAttr(name.trim())}"`);
  if (title?.trim()) attributes.push(`title="${escapeXmlAttr(title.trim())}"`);

  const details = [
    description?.trim() && `<description>${escapeXmlContent(description.trim())}</description>`,
    systemRole?.trim() && `<system_role>${escapeXmlContent(systemRole.trim())}</system_role>`,
  ].filter(Boolean);

  return `<agent ${attributes.join(' ')}>${details.join('')}</agent>`;
};

export const buildAgentArtworkPrompt = (input: AgentArtworkPromptInput): string => {
  const agentContext = formatAgentContext({
    description: input.description,
    id: input.id,
    name: input.name,
    systemRole: input.systemRole?.slice(0, 1200),
    title: input.title,
  });
  const styleDirection = STYLE_DIRECTIONS[input.style ?? DEFAULT_AGENT_ARTWORK_STYLE];

  if (input.kind === 'avatar') {
    // The reference paragraph preserves palette / materials / motifs but not the
    // rendering style itself — the user may regenerate with a different preset,
    // and the style direction above must stay authoritative.
    const referenceDirection = input.referenceImageUrl?.trim()
      ? `\n\nUse the attached existing profile background as the visual source of truth. Preserve its dominant color palette, materials, lighting, atmosphere, and recurring motifs while distilling them into a single avatar subject. The avatar must feel designed as part of the same identity system, not merely depict a related topic.`
      : '';

    return `Create a distinctive square profile icon for the AI agent described below.

${agentContext}

Translate the agent's identity, purpose, and personality into one coherent visual concept. Use a single centered subject with a simple silhouette. ${styleDirection} ${MOTIF_DIRECTION} Fill the entire square canvas edge to edge with the artwork: use a full-bleed composition with no white background, no white matte, no empty margin, no padding, no frame, and no border. No words, no letters, and no logo. The result must remain clear as a small app avatar.${referenceDirection}`;
  }

  const referenceDirection = input.referenceImageUrl?.trim()
    ? `\n\nUse the attached existing avatar as the visual source of truth. Preserve its dominant color palette, materials, lighting, atmosphere, and recurring motifs, then expand that visual world into a wide environment. Do not enlarge, repeat, or place the avatar itself in the cover. The cover and avatar must feel designed as one identity system.`
    : '';

  return `Create a wide cinematic profile cover for the AI agent described below.

${agentContext}

Translate the agent's identity, purpose, and personality into an abstract environment. ${styleDirection} ${MOTIF_DIRECTION} Use generous negative space and a balanced composition. Do not use a person portrait, words, letters, a logo, or a border.${referenceDirection}`;
};
