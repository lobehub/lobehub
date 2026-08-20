import { escapeXmlAttr, escapeXmlContent } from '../search/xmlEscape';

export type AgentArtworkKind = 'avatar' | 'background';
export type AgentArtworkComposition = 'avatar' | 'fullBody';

export const AGENT_ARTWORK_STYLES = ['lobe', 'anime', 'lineArt', 'pixel', 'painterly'] as const;

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
  anime:
    'Render it in an expressive FLCL-inspired Japanese anime style. Choose an age and character archetype that fits the agent, such as a young boy, a playful young woman, a mature onee-san, or a handsome older man. Use a matching solid-color background with no decorations.',
  lineArt:
    "Render it as minimalist hand-drawn line art. Use the pose and styling to communicate the agent's professional traits. Use a pure white background.",
  lobe: "Render it as a bold mascot-style 3D emoji character: skin in one friendly likeable color that people love — warm yellow, orange, peach, coral, or soft brown (not realistic human skin, and never odd tones like green, teal, or gray), graphic simplified facial features with an expression that matches the agent's personality (a knowing wink, a curious smile, a warm grin — lively, never blank or babyish), glossy candy-like materials with soft studio lighting, and one vivid contrasting solid background color. Express the identity through a hat and one or two small accessory props — do not draw scenes, maps, or diagrams on the character.",
  painterly:
    'Render it with a cinematic 3D-to-2D hand-painted texture and dramatic stylization inspired by premium animated fantasy series, against a matching solid-color background.',
  pixel:
    'Render it as crisp pixel art on a 64 x 64 pixel grid, against a matching solid-color background with no decorations.',
};

/**
 * Every style direction above signs off with its own background clause — a
 * matching color, or pure white. Both fight the cut-out: a matching color is by
 * definition close to the character's palette, and white collides with the
 * white that anime and line-art styles put on the character. These variants
 * drop that clause so the contrast requirement above is the only backdrop rule.
 */
const FULL_BODY_STYLE_OVERRIDES: Record<AgentArtworkStyle, string> = {
  anime: STYLE_DIRECTIONS.anime.replace(
    ' Use a matching solid-color background with no decorations.',
    '',
  ),
  lineArt: STYLE_DIRECTIONS.lineArt.replace(' Use a pure white background.', ''),
  lobe: STYLE_DIRECTIONS.lobe.replace(', and one vivid contrasting solid background color', ''),
  painterly: STYLE_DIRECTIONS.painterly.replace(', against a matching solid-color background', ''),
  pixel: STYLE_DIRECTIONS.pixel.replace(
    ', against a matching solid-color background with no decorations',
    '',
  ),
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

const AVATAR_CANVAS_DIRECTION = `Fill the entire square canvas edge to edge with the artwork: use a full-bleed composition with no white background, no white matte, no empty margin, no padding, no frame, and no border. No words, no letters, and no logo. The result must remain clear as a small app avatar.`;
/**
 * The full-body artwork is composited onto product surfaces, so its backdrop has
 * to come off afterwards. Asking the model for "a transparent background" does
 * NOT work — the returned image has no alpha channel and the model paints a
 * checkerboard *depicting* transparency instead. So we ask for the one thing it
 * can actually deliver: a single flat keyable color, which the client then cuts
 * out (see `cutOutFlatBackground`).
 */
const FULL_BODY_CANVAS_DIRECTION = `Use the entire portrait canvas for a clean character presentation. Place the character against one completely flat, uniform background color that contrasts clearly with the character and appears nowhere on the character itself: exactly one solid color across the whole canvas, with no gradient, no shading, no texture, no scenery, no ground plane, and no cast or drop shadow, so the background can be keyed out cleanly. Never draw a checkerboard, grid, or any other pattern that depicts transparency. No frame, no border, no words, no letters, and no logo.`;

const AVATAR_COMPOSITION_DIRECTION = `Compose a close-up avatar: the head fills most of the frame, with at most a little of the upper body visible.`;
const FULL_BODY_COMPOSITION_DIRECTION = `Compose a complete head-to-toe character image: show the entire body clearly, centered in a natural standing or action pose, with comfortable breathing room around the silhouette. Keep the face expressive and readable.`;

/**
 * `character` is for avatars, where the references define the TARGET subject
 * feel (the official mascot look) — the wording asks for that same energy while
 * fencing off the literal faces / hats / subjects, since copying those would
 * make every avatar look like the same mascot. `surface` is for covers, which
 * forbid portraits and may only borrow rendering qualities.
 */
const buildStyleReferenceDirection = (
  count: number,
  mode: 'character' | 'fullBodyCharacter' | 'surface',
  subject: string,
  /**
   * A preset reference is one of ours: it stands for a look, so the prompt has
   * to fence off its literal subject. A reference the user attached is the
   * opposite — they are pointing at the character they want, and refusing to
   * follow it would ignore the only thing they said.
   */
  isUserSupplied = false,
): string => {
  if (count === 0) return '';

  const imageWord = count === 1 ? 'image' : 'images';
  const possessive = count === 1 ? 'its' : 'their';

  if (isUserSupplied)
    return `\n\nThe user attached the ${imageWord} as ${possessive} own reference for this character. Follow ${possessive} appearance closely — the same character design, features, palette, and rendering — and adapt it to the composition and canvas rules above rather than inventing a different character.`;

  if (mode === 'surface')
    return `\n\nUse the attached ${imageWord} only as a rendering-style reference — match ${possessive} materials, lighting, color saturation, and level of finish. Do not copy ${possessive} subjects or compositions.`;

  const compositionQualities =
    mode === 'fullBodyCharacter'
      ? 'character design, line quality, materials, lighting, and color energy'
      : 'mascot-like head-dominant look, single-color skin, material, lighting, and color energy';

  return `\n\nUse the attached ${imageWord} as the target character style — the same ${compositionQualities}. Do not copy ${possessive} exact faces, hats, or subjects — invent a new character for the ${subject} described above.`;
};

/**
 * The user's own words are the most specific input we have, so they go last —
 * models weight the tail of a prompt heavily — while the canvas, composition
 * and no-text rules stay authoritative because product surfaces depend on them.
 */
const buildUserDirection = (direction?: string | null): string => {
  const trimmed = direction?.trim();
  if (!trimmed) return '';

  return `\n\nThe user asked for this specifically: ${escapeXmlContent(trimmed.slice(0, 600))}. Follow it wherever it does not conflict with the canvas, composition, and no-text rules above.`;
};

const countStyleReferences = (urls?: string[] | null): number =>
  urls?.filter((url) => url.trim()).length ?? 0;

export interface AgentArtworkPromptInput {
  composition?: AgentArtworkComposition;
  description?: string | null;
  /**
   * Free-text direction the user typed in the studio ("a boy with glasses",
   * "cyberpunk mechanic"). It is the most specific thing we know about what
   * they want, so it lands last and is allowed to override the derived
   * concept — but not the canvas or composition rules, which the product
   * depends on.
   */
  direction?: string | null;
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
  /**
   * Where `styleReferenceImageUrls` came from. `custom` means the user attached
   * them, which flips the wording from "borrow this look" to "follow this
   * character" — see {@link buildStyleReferenceDirection}.
   */
  styleReferenceSource?: 'preset' | 'custom' | null;
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
  const composition = input.composition ?? 'avatar';
  const styleDirection =
    input.kind === 'background'
      ? (BACKGROUND_STYLE_OVERRIDES[style] ?? STYLE_DIRECTIONS[style])
      : composition === 'fullBody'
        ? FULL_BODY_STYLE_OVERRIDES[style]
        : STYLE_DIRECTIONS[style];

  const styleReferenceCount = countStyleReferences(input.styleReferenceImageUrls);
  const styleReferenceDirection = buildStyleReferenceDirection(
    styleReferenceCount,
    input.kind === 'background'
      ? 'surface'
      : composition === 'fullBody'
        ? 'fullBodyCharacter'
        : 'character',
    'agent',
    input.styleReferenceSource === 'custom',
  );
  const counterpartReferenceUrl = styleReferenceCount > 0 ? undefined : input.referenceImageUrl;
  const userDirection = buildUserDirection(input.direction);

  if (input.kind === 'avatar') {
    // The reference paragraph preserves palette / materials / motifs but not the
    // rendering style itself — the user may regenerate with a different preset,
    // and the style direction above must stay authoritative.
    const referenceDirection = counterpartReferenceUrl?.trim()
      ? composition === 'fullBody'
        ? `\n\nUse the attached existing avatar as the exact character source of truth. Preserve the same identity, face, hair, outfit, accessories, color palette, materials, and rendering style while extending that character into a complete head-to-toe pose. Do not redesign or reinterpret the character. Take nothing but the character from it — ignore the avatar's background entirely and use the flat keyable backdrop described above instead.`
        : `\n\nUse the attached existing profile background as the visual source of truth. Preserve its dominant color palette, materials, lighting, atmosphere, and recurring motifs while distilling them into a single avatar subject. The avatar must feel designed as part of the same identity system, not merely depict a related topic.`
      : '';

    const compositionDirection =
      composition === 'fullBody' ? FULL_BODY_COMPOSITION_DIRECTION : AVATAR_COMPOSITION_DIRECTION;
    const canvasDirection =
      composition === 'fullBody' ? FULL_BODY_CANVAS_DIRECTION : AVATAR_CANVAS_DIRECTION;

    const canvasShape = composition === 'fullBody' ? 'portrait' : 'square';

    return `Create a distinctive ${canvasShape} character image for the AI agent described below.

${agentContext}

Translate the agent's identity, purpose, and personality into one coherent visual concept. Use a single centered subject with a simple silhouette. ${compositionDirection} ${styleDirection} ${MOTIF_DIRECTION} ${canvasDirection}${styleReferenceDirection}${referenceDirection}${userDirection}`;
  }

  const referenceDirection = counterpartReferenceUrl?.trim()
    ? `\n\nUse the attached existing avatar as the visual source of truth. Preserve its dominant color palette, materials, lighting, atmosphere, and recurring motifs, then expand that visual world into a wide environment. Do not enlarge, repeat, or place the avatar itself in the cover. The cover and avatar must feel designed as one identity system.`
    : '';

  return `Create a wide cinematic profile cover for the AI agent described below.

${agentContext}

Translate the agent's identity, purpose, and personality into an abstract environment. ${styleDirection} ${MOTIF_DIRECTION} Use generous negative space and a balanced composition. Do not use a person portrait, words, letters, a logo, or a border.${styleReferenceDirection}${referenceDirection}${userDirection}`;
};

/**
 * A workspace is a team rather than a character, so the mascot direction's
 * "the agent's personality" phrasing has to be re-pointed at the team. Only the
 * presets whose wording names the agent need an override.
 */
const WORKSPACE_STYLE_OVERRIDES: Partial<Record<AgentArtworkStyle, string>> = {
  lobe: STYLE_DIRECTIONS.lobe.replace("the agent's personality", "the team's character"),
};

const WORKSPACE_MOTIF_DIRECTION = `Ground the imagery in what this team actually works on. Avoid generic AI and technology clichés — starry space scenes, glowing particles, circuit boards, neural-network lines, holographic grids — unless the team's work is explicitly about them.`;

export interface WorkspaceArtworkPromptInput {
  description?: string | null;
  id: string;
  name?: string | null;
  style?: AgentArtworkStyle | null;
  /** See {@link AgentArtworkPromptInput.styleReferenceImageUrls}. */
  styleReferenceImageUrls?: string[] | null;
}

const formatWorkspaceContext = ({
  description,
  id,
  name,
}: Omit<WorkspaceArtworkPromptInput, 'style' | 'styleReferenceImageUrls'>): string => {
  const attributes = [`id="${escapeXmlAttr(id)}"`];

  if (name?.trim()) attributes.push(`name="${escapeXmlAttr(name.trim())}"`);

  const details = description?.trim()
    ? `<description>${escapeXmlContent(description.trim())}</description>`
    : '';

  return `<workspace ${attributes.join(' ')}>${details}</workspace>`;
};

/**
 * Square brand avatar for a team workspace. Workspaces have no cover artwork
 * and no system role, so this is deliberately avatar-only and much narrower
 * than {@link buildAgentArtworkPrompt}.
 */
export const buildWorkspaceArtworkPrompt = (input: WorkspaceArtworkPromptInput): string => {
  const workspaceContext = formatWorkspaceContext({
    description: input.description,
    id: input.id,
    name: input.name,
  });
  const style = input.style ?? DEFAULT_AGENT_ARTWORK_STYLE;
  const styleDirection = WORKSPACE_STYLE_OVERRIDES[style] ?? STYLE_DIRECTIONS[style];
  const styleReferenceDirection = buildStyleReferenceDirection(
    countStyleReferences(input.styleReferenceImageUrls),
    'character',
    'team',
  );

  return `Create a distinctive square profile icon for the team workspace described below.

${workspaceContext}

Translate the team's name, focus, and character into one coherent visual concept. Use a single centered subject with a simple silhouette. ${styleDirection} ${WORKSPACE_MOTIF_DIRECTION} ${AVATAR_CANVAS_DIRECTION}${styleReferenceDirection}`;
};
