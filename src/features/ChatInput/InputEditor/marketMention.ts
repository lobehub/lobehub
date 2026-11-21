/**
 * Market entries offered by the @ menu are not installed yet. Their chips carry
 * a placeholder agent id (or, for skills, an identifier the local catalog does
 * not know); the composer installs them right before sending and swaps the
 * placeholders for the installed agent ids, so the runtime only ever sees
 * regular agent mentions and installed skills.
 */

const MARKET_AGENT_ID_PREFIX = 'market:';

export type MarketInstallVisibility = 'private' | 'public';

export interface PendingMarketAgent {
  identifier: string;
  label: string;
  visibility: MarketInstallVisibility;
}

export interface ComposerContent {
  editorData: Record<string, any> | undefined;
  markdown: string;
}

export const marketAgentMentionId = (identifier: string) =>
  `${MARKET_AGENT_ID_PREFIX}${identifier}`;

const isPendingMarketAgent = (metadata: Record<string, unknown> | undefined) =>
  metadata?.type === 'agent' &&
  typeof metadata.marketIdentifier === 'string' &&
  metadata.id === marketAgentMentionId(metadata.marketIdentifier);

const walk = (node: any, visit: (node: any) => void) => {
  if (!node) return;
  visit(node);
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, visit);
};

export const collectPendingMarketAgents = (
  editorData: Record<string, any> | undefined,
): PendingMarketAgent[] => {
  const pending = new Map<string, PendingMarketAgent>();

  walk(editorData?.root, (node) => {
    if (node.type !== 'mention' || !isPendingMarketAgent(node.metadata)) return;
    const identifier = node.metadata.marketIdentifier as string;
    if (pending.has(identifier)) return;

    pending.set(identifier, {
      identifier,
      label: String(node.metadata.label ?? node.label ?? identifier),
      visibility: node.metadata.marketVisibility === 'private' ? 'private' : 'public',
    });
  });

  return [...pending.values()];
};

export interface PendingMarketSkill {
  identifier: string;
  /** Display name shown to the user while it is prepared or when it fails. */
  label: string;
}

/** Skill chips whose identifier is not installed locally — the menu only offers those from the market. */
export const collectPendingMarketSkills = (
  editorData: Record<string, any> | undefined,
  installedSkillIdentifiers: ReadonlySet<string>,
): PendingMarketSkill[] => {
  const pending = new Map<string, PendingMarketSkill>();

  walk(editorData?.root, (node) => {
    if (node.type !== 'action-tag' || node.actionCategory !== 'skill') return;
    const identifier = String(node.actionType ?? '');
    if (!identifier || installedSkillIdentifiers.has(identifier) || pending.has(identifier)) return;
    pending.set(identifier, { identifier, label: String(node.actionLabel || identifier) });
  });

  return [...pending.values()];
};

/** Point the chips and the serialized `<mention>` tags at the installed agents. */
export const applyInstalledMarketAgents = (
  { editorData, markdown }: ComposerContent,
  installedAgentIds: ReadonlyMap<string, string>,
): ComposerContent => {
  if (installedAgentIds.size === 0) return { editorData, markdown };

  const nextEditorData = editorData ? structuredClone(editorData) : editorData;
  walk(nextEditorData?.root, (node) => {
    if (node.type !== 'mention' || !isPendingMarketAgent(node.metadata)) return;
    const { marketIdentifier, marketVisibility: _visibility, ...rest } = node.metadata;
    const agentId = installedAgentIds.get(marketIdentifier);
    if (!agentId) return;

    node.metadata = { ...rest, id: agentId };
  });

  let nextMarkdown = markdown;
  for (const [identifier, agentId] of installedAgentIds) {
    nextMarkdown = nextMarkdown
      .split(`id="${marketAgentMentionId(identifier)}"`)
      .join(`id="${agentId}"`);
  }

  return { editorData: nextEditorData, markdown: nextMarkdown };
};
