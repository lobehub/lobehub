import type { EnabledProviderWithModels } from '@/types/aiProvider';

export type AgentArtworkKind = 'avatar' | 'background';

const IMAGE_SOURCE_PATTERN = /^(?:https?:\/\/|\/|data:image\/)/i;
const PREFERRED_ARTWORK_MODEL = 'gpt-image-2';

/**
 * Agent `backgroundColor` historically stored CSS colors. It now stores the
 * profile cover image without requiring a database migration. Only image-like
 * sources are accepted, so legacy colors quietly resolve to no cover.
 */
export const resolveAgentBackground = (value?: string | null): string | undefined => {
  const source = value?.trim();

  return source && IMAGE_SOURCE_PATTERN.test(source) ? source : undefined;
};

export const selectAgentArtworkModel = (providers: EnabledProviderWithModels[]) => {
  for (const provider of providers) {
    const model = provider.children.find(({ id }) => id === PREFERRED_ARTWORK_MODEL);
    if (model) return { model, provider };
  }

  const provider = providers[0];
  const model = provider?.children[0];

  return provider && model ? { model, provider } : undefined;
};

interface AgentArtworkPromptInput {
  description?: string | null;
  kind: AgentArtworkKind;
  name?: string | null;
  systemRole?: string | null;
  title?: string | null;
}

export const buildAgentArtworkPrompt = ({
  description,
  kind,
  name,
  systemRole,
  title,
}: AgentArtworkPromptInput): string => {
  const identity = [name, title, description, systemRole]
    .map((item) => item?.trim())
    .filter(Boolean)
    .join('. ')
    .slice(0, 1200);

  const subject = identity || 'a capable, friendly AI agent';

  if (kind === 'avatar') {
    return `Create a distinctive square profile icon for this AI agent: ${subject}. Single centered subject, simple silhouette, polished editorial illustration, calm colors, high contrast, no words, no letters, no logo, no border, suitable for a small app avatar.`;
  }

  return `Create a wide cinematic profile cover for this AI agent: ${subject}. Abstract editorial environment that expresses the agent's role, calm premium visual language, generous negative space, balanced composition, no person portrait, no words, no letters, no logo, no border.`;
};
