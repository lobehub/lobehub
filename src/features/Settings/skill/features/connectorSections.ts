import type { ComposioAppType, LobehubSkillProviderType } from '@lobechat/const';
import {
  getConnectorCatalog,
  getLobehubSkillProviderById,
  RECOMMENDED_SKILLS,
  RecommendedSkillType,
} from '@lobechat/const';
import type { TFunction } from 'i18next';

export type IntegrationItem =
  | { provider: LobehubSkillProviderType; type: 'lobehub' }
  | { serverType: ComposioAppType; type: 'composio' };

export const countConnectorTabItems = (items: {
  customConnectors: readonly unknown[];
  integrations: readonly IntegrationItem[];
  marketplaceConnectors: readonly unknown[];
}) =>
  items.customConnectors.length + items.marketplaceConnectors.length + items.integrations.length;

/** A page group shows this many rows before "Show all" (the first screen stays scannable). */
export const SECTION_PREVIEW_LIMIT = 6;

export interface BuildIntegrationItemsParams {
  connectorAvailability: { composio: boolean; lobehub: boolean };
  isComposioActive: (identifier: string) => boolean;
  isLobehubConnected: (providerId: string) => boolean;
  /**
   * Providers listed even where LobeHub connectors are off, because their page
   * also manages an integration the deployment may have configured on its own.
   */
  pageOnlyProviderIds?: readonly string[];
  /** Defaults to the app's `RECOMMENDED_SKILLS`; injectable for tests. */
  recommendedSkills?: typeof RECOMMENDED_SKILLS;
}

export const isIntegrationConnected = (
  item: IntegrationItem,
  params: Pick<BuildIntegrationItemsParams, 'isComposioActive' | 'isLobehubConnected'>,
): boolean => {
  switch (item.type) {
    case 'lobehub': {
      return params.isLobehubConnected(item.provider.id);
    }
    case 'composio': {
      return params.isComposioActive(item.serverType.identifier);
    }
  }
};

/** Connected OAuth apps first, then recommendations, retaining catalog order within ties. */
export const buildIntegrationItems = (params: BuildIntegrationItemsParams): IntegrationItem[] => {
  const {
    connectorAvailability,
    isComposioActive,
    pageOnlyProviderIds = [],
    recommendedSkills = RECOMMENDED_SKILLS,
  } = params;
  const recommended = recommendedSkills
    .filter((s) => s.type !== RecommendedSkillType.Builtin)
    .map((s) => s.id);
  const rank = (item: IntegrationItem) => {
    const id = item.type === 'lobehub' ? item.provider.id : item.serverType.identifier;
    const index = recommended.indexOf(id);
    return index < 0 ? recommended.length : index;
  };
  const pageOnlyItems: IntegrationItem[] = connectorAvailability.lobehub
    ? []
    : pageOnlyProviderIds.flatMap((id) => {
        const provider = getLobehubSkillProviderById(id);
        return provider ? [{ provider, type: 'lobehub' as const }] : [];
      });
  return [...getConnectorCatalog(connectorAvailability), ...pageOnlyItems]
    .filter(
      (item) =>
        recommendedSkills.length > 0 ||
        item.type !== 'composio' ||
        isComposioActive(item.serverType.identifier),
    )
    .sort(
      (a, b) =>
        Number(isIntegrationConnected(b, params)) - Number(isIntegrationConnected(a, params)) ||
        rank(a) - rank(b),
    );
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

/**
 * Whether a page group's heading is its expand control (the Codex `Popular >`):
 * only a group with rows beyond its preview, or one already expanded, gets the
 * chevron. A search already shows every hit, so it has nothing to expand.
 */
export const isSectionExpandable = ({
  expanded,
  hiddenCount,
  searching,
}: {
  expanded: boolean;
  hiddenCount: number;
  searching: boolean;
}): boolean => !searching && (hiddenCount > 0 || expanded);
