import { escapeXmlAttr, escapeXmlContent } from '../search/xmlEscape';

export type AgentArtworkKind = 'avatar' | 'background';

export const AGENT_ARTWORK_STYLES = [
  'lobe',
  'clay',
  'watercolor',
  'geometric',
  'pixel',
  'sticker',
] as const;

export type AgentArtworkStyle = (typeof AGENT_ARTWORK_STYLES)[number];

export const DEFAULT_AGENT_ARTWORK_STYLE: AgentArtworkStyle = 'lobe';

/**
 * Wording here is A/B-tested against real Nano Banana output. Two phrasings
 * that measurably ruin the lobe style: "inflated" (produces a puffy relief
 * carving instead of a character) and letting the domain motif land ON the
 * character (maps / diagrams embossed on the body) — identity must flow
 * through outfit and accessories instead.
 */
const STYLE_DIRECTIONS: Record<AgentArtworkStyle, string> = {
  clay: 'Render it as a soft 3D clay-style figure with rounded forms, matte materials, subtle hand-made charm, gentle studio lighting, and warm pastel colors.',
  geometric:
    'Render it as flat geometric illustration built from bold simple shapes, crisp edges, and a confident limited palette in the spirit of mid-century poster design.',
  lobe: "Render it as a bold mascot-style 3D emoji character: a single oversized head filling most of the frame, skin in one friendly likeable color that people love — warm yellow, orange, peach, coral, or soft brown (not realistic human skin, and never odd tones like green, teal, or gray), graphic simplified facial features with an expression that matches the agent's personality (a knowing wink, a curious smile, a warm grin — lively, never blank or babyish), glossy candy-like materials with soft studio lighting, and one vivid contrasting solid background color. Show at most a hint of shoulders. Express the identity through a hat and one or two small floating accessory props beside the head — do not draw scenes, maps, or diagrams on the character.",
  pixel:
    'Render it as crisp retro pixel art with chunky readable pixels, a limited bright palette, and clean shading in the spirit of classic 16-bit games.',
  sticker:
    'Render it as a glossy die-cut sticker illustration with bold clean outlines, flat vivid colors, a thick white sticker border, and a simple bright solid background.',
  watercolor:
    'Render it as a hand-painted watercolor piece with visible paper texture, soft pigment washes, and loose organic edges.',
};

/**
 * The avatar directions above are subject-shaped (the lobe one literally asks
 * for a character), which contradicts the cover prompt's "abstract environment,
 * no person portrait" frame. Cover generation swaps in these style-only
 * variants where the avatar wording would fight the cover composition.
 */
const BACKGROUND_STYLE_OVERRIDES: Partial<Record<AgentArtworkStyle, string>> = {
  lobe: 'Render it as a soft 3D cartoon world with smooth rounded matte forms, playful proportions, and one vivid saturated dominant color filling the frame.',
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
  /**
   * Attached images that define the target rendering style (not the subject).
   * When present they win over `referenceImageUrl`: mixing "copy this style"
   * and "continue this identity system" wording in one prompt makes the model
   * blend the two references unpredictably.
   */
  styleReferenceImageUrls?: string[] | null;
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
  const style = input.style ?? DEFAULT_AGENT_ARTWORK_STYLE;
  const styleDirection =
    input.kind === 'background'
      ? (BACKGROUND_STYLE_OVERRIDES[style] ?? STYLE_DIRECTIONS[style])
      : STYLE_DIRECTIONS[style];

  const styleReferenceCount =
    input.styleReferenceImageUrls?.filter((url) => url.trim()).length ?? 0;
  // For avatars the references define the TARGET character feel (the official
  // mascot look), so the wording asks for that same energy while fencing off
  // the literal faces / hats / subjects — copying those would make every agent
  // look like the same mascot. Covers must not inherit the character wording
  // (they forbid portraits), so they only borrow surface qualities.
  const styleReferenceDirection =
    styleReferenceCount > 0
      ? input.kind === 'avatar'
        ? `\n\nUse the attached ${styleReferenceCount === 1 ? 'image' : 'images'} as the target character style — the same mascot-like head-dominant look, single-color skin, material, lighting, and color energy. Do not copy ${styleReferenceCount === 1 ? 'its' : 'their'} exact faces, hats, or subjects — invent a new character for the agent described above.`
        : `\n\nUse the attached ${styleReferenceCount === 1 ? 'image' : 'images'} only as a rendering-style reference — match ${styleReferenceCount === 1 ? 'its' : 'their'} materials, lighting, color saturation, and level of finish. Do not copy ${styleReferenceCount === 1 ? 'its' : 'their'} subjects or compositions.`
      : '';
  const counterpartReferenceUrl = styleReferenceCount > 0 ? undefined : input.referenceImageUrl;

  if (input.kind === 'avatar') {
    // The reference paragraph preserves palette / materials / motifs but not the
    // rendering style itself — the user may regenerate with a different preset,
    // and the style direction above must stay authoritative.
    const referenceDirection = counterpartReferenceUrl?.trim()
      ? `\n\nUse the attached existing profile background as the visual source of truth. Preserve its dominant color palette, materials, lighting, atmosphere, and recurring motifs while distilling them into a single avatar subject. The avatar must feel designed as part of the same identity system, not merely depict a related topic.`
      : '';

    return `Create a distinctive square profile icon for the AI agent described below.

${agentContext}

Translate the agent's identity, purpose, and personality into one coherent visual concept. Use a single centered subject with a simple silhouette. ${styleDirection} ${MOTIF_DIRECTION} Fill the entire square canvas edge to edge with the artwork: use a full-bleed composition with no white background, no white matte, no empty margin, no padding, no frame, and no border. No words, no letters, and no logo. The result must remain clear as a small app avatar.${styleReferenceDirection}${referenceDirection}`;
  }

  const referenceDirection = counterpartReferenceUrl?.trim()
    ? `\n\nUse the attached existing avatar as the visual source of truth. Preserve its dominant color palette, materials, lighting, atmosphere, and recurring motifs, then expand that visual world into a wide environment. Do not enlarge, repeat, or place the avatar itself in the cover. The cover and avatar must feel designed as one identity system.`
    : '';

  return `Create a wide cinematic profile cover for the AI agent described below.

${agentContext}

Translate the agent's identity, purpose, and personality into an abstract environment. ${styleDirection} ${MOTIF_DIRECTION} Use generous negative space and a balanced composition. Do not use a person portrait, words, letters, a logo, or a border.${styleReferenceDirection}${referenceDirection}`;
};
