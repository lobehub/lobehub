import type { ComposioAppType, LobehubSkillProviderType } from '@lobechat/const';
import {
  getConnectorCatalog,
  RECOMMENDED_SKILLS,
  RecommendedSkillType,
  resolveConnectorCatalogItem,
} from '@lobechat/const';
import type { BuiltinSkillManifest, LobeBuiltinTool } from '@lobechat/types';
import type { TFunction } from 'i18next';

export type IntegrationItem =
  | { builtinAgentSkill: BuiltinSkillManifest; type: 'builtinAgent' }
  | { builtinTool: LobeBuiltinTool; type: 'builtin' }
  | { provider: LobehubSkillProviderType; type: 'lobehub' }
  | { serverType: ComposioAppType; type: 'composio' };

/** A page group shows this many rows before "Show all" (the first screen stays scannable). */
export const SECTION_PREVIEW_LIMIT = 6;

export interface BuildIntegrationItemsParams {
  allBuiltinTools: LobeBuiltinTool[];
  builtinSkills: BuiltinSkillManifest[];
  connectorAvailability: { composio: boolean; lobehub: boolean };
  isBuiltinToolInstalled: (identifier: string) => boolean;
  isComposioActive: (identifier: string) => boolean;
  isLobehubConnected: (providerId: string) => boolean;
  /** Defaults to the app's `RECOMMENDED_SKILLS`; injectable for tests. */
  recommendedSkills?: typeof RECOMMENDED_SKILLS;
}

export const isIntegrationConnected = (
  item: IntegrationItem,
  params: Pick<
    BuildIntegrationItemsParams,
    'isBuiltinToolInstalled' | 'isComposioActive' | 'isLobehubConnected'
  >,
): boolean => {
  switch (item.type) {
    case 'builtinAgent': {
      return params.isBuiltinToolInstalled(item.builtinAgentSkill.identifier);
    }
    case 'builtin': {
      return params.isBuiltinToolInstalled(item.builtinTool.identifier);
    }
    case 'lobehub': {
      return params.isLobehubConnected(item.provider.id);
    }
    case 'composio': {
      return params.isComposioActive(item.serverType.identifier);
    }
  }
};

/**
 * Every integration the connector / skill lists can show, connected ones first:
 * built-in agent skills, built-in tools and the LobeHub / Composio OAuth catalog.
 */
export const buildIntegrationItems = (params: BuildIntegrationItemsParams): IntegrationItem[] => {
  const {
    allBuiltinTools,
    builtinSkills,
    connectorAvailability,
    isBuiltinToolInstalled,
    isComposioActive,
    recommendedSkills = RECOMMENDED_SKILLS,
  } = params;

  // Built-in agent skills first so they appear early in the list.
  let items: IntegrationItem[] = builtinSkills.map((skill) => ({
    builtinAgentSkill: skill,
    type: 'builtinAgent' as const,
  }));

  const addedBuiltinIds = new Set<string>();
  const addedConnectorIds = new Set<string>();

  if (recommendedSkills.length > 0) {
    for (const skill of recommendedSkills) {
      if (skill.type === RecommendedSkillType.Builtin) {
        const builtinTool = allBuiltinTools.find((tool) => tool.identifier === skill.id);
        if (builtinTool && !builtinTool.hidden) {
          items.push({ builtinTool, type: 'builtin' });
          addedBuiltinIds.add(skill.id);
        }
      } else {
        const connector = resolveConnectorCatalogItem(skill.id, connectorAvailability);
        if (connector && !addedConnectorIds.has(skill.id)) {
          items.push(connector);
          addedConnectorIds.add(skill.id);
        }
      }
    }

    // Installed built-in tools that are not recommended still belong in the list.
    for (const tool of allBuiltinTools) {
      if (
        !tool.hidden &&
        isBuiltinToolInstalled(tool.identifier) &&
        !addedBuiltinIds.has(tool.identifier)
      ) {
        items.push({ builtinTool: tool, type: 'builtin' });
      }
    }

    // Every remaining connector through the shared ownership resolver, so one
    // identifier never renders through both LobeHub and Composio authorization.
    for (const connector of getConnectorCatalog(connectorAvailability)) {
      const identifier =
        connector.type === 'lobehub' ? connector.provider.id : connector.serverType.identifier;
      if (!addedConnectorIds.has(identifier)) {
        items.push(connector);
        addedConnectorIds.add(identifier);
      }
    }
  } else {
    for (const tool of allBuiltinTools) {
      if (!tool.hidden) items.push({ builtinTool: tool, type: 'builtin' });
    }

    items.push(...getConnectorCatalog(connectorAvailability));

    // Show all built-in and LobeHub entries, but only connected Composio apps.
    items = items.filter(
      (item) => item.type !== 'composio' || isComposioActive(item.serverType.identifier),
    );
  }

  // Stable sort: connected / installed first, catalog order otherwise.
  return items.sort((a, b) => {
    const connectedA = isIntegrationConnected(a, params);
    const connectedB = isIntegrationConnected(b, params);
    if (connectedA === connectedB) return 0;
    return connectedA ? -1 : 1;
  });
};

/** Case-insensitive match of a search keyword against any of an entry's text fields. */
export const matchesConnectorKeyword = (
  keyword: string | undefined,
  fields: Array<string | null | undefined>,
): boolean => {
  const needle = keyword?.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => !!field && field.toLowerCase().includes(needle));
};

export const matchesIntegrationKeyword = (
  item: IntegrationItem,
  keyword: string | undefined,
  t: TFunction<'setting'>,
): boolean => {
  switch (item.type) {
    case 'builtin': {
      const tool = item.builtinTool;
      return matchesConnectorKeyword(keyword, [
        t(`tools.builtins.${tool.identifier}.title`, {
          defaultValue: tool.title || tool.identifier,
        }),
        tool.identifier,
        t(`tools.builtins.${tool.identifier}.description`, {
          defaultValue: tool.description ?? '',
        }),
      ]);
    }
    case 'lobehub': {
      return matchesConnectorKeyword(keyword, [
        item.provider.label,
        item.provider.id,
        item.provider.description,
        t(`tools.lobehubSkill.providers.${item.provider.id}.description`, {
          defaultValue: item.provider.description,
        }),
      ]);
    }
    case 'composio': {
      return matchesConnectorKeyword(keyword, [
        item.serverType.label,
        item.serverType.identifier,
        item.serverType.description,
        t(`tools.composio.servers.${item.serverType.identifier}.description`, {
          defaultValue: item.serverType.description,
        }),
      ]);
    }
    default: {
      return true;
    }
  }
};

/**
 * Split a group into what is already installed / connected and what is still
 * available to add, keeping each side's order.
 */
export const partitionByInstalled = <T>(
  items: T[],
  isInstalled: (item: T) => boolean,
): { available: T[]; installed: T[] } => {
  const installed: T[] = [];
  const available: T[] = [];
  for (const item of items) (isInstalled(item) ? installed : available).push(item);
  return { available, installed };
};

/** The rows a group renders: all of them when expanded, otherwise the preview. */
export const getVisibleSectionItems = <T>(
  items: T[],
  expanded: boolean,
  limit = SECTION_PREVIEW_LIMIT,
): { hiddenCount: number; visible: T[] } => {
  if (expanded || items.length <= limit) return { hiddenCount: 0, visible: items };
  return { hiddenCount: items.length - limit, visible: items.slice(0, limit) };
};
