import { escapeXmlAttr, escapeXmlContent } from '../search/xmlEscape';

export type AgentArtworkKind = 'avatar' | 'background';

export interface AgentArtworkPromptInput {
  description?: string | null;
  id: string;
  kind: AgentArtworkKind;
  name?: string | null;
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

  if (input.kind === 'avatar') {
    return `Create a distinctive square profile icon for the AI agent described below.

${agentContext}

Translate the agent's identity, purpose, and personality into one coherent visual concept. Use a single centered subject, a simple silhouette, polished editorial illustration, calm colors, and high contrast. Fill the entire square canvas edge to edge with the artwork: use a full-bleed composition with no white background, no white matte, no empty margin, no padding, no frame, and no border. No words, no letters, and no logo. The result must remain clear as a small app avatar.`;
  }

  return `Create a wide cinematic profile cover for the AI agent described below.

${agentContext}

Translate the agent's identity, purpose, and personality into an abstract editorial environment. Use a calm premium visual language, generous negative space, and a balanced composition. Do not use a person portrait, words, letters, a logo, or a border.`;
};
