import type { ComposioAppType } from './composio';
import { COMPOSIO_APP_TYPES } from './composio';
import type { LobehubSkillProviderType } from './lobehubSkill';
import { LOBEHUB_SKILL_PROVIDERS } from './lobehubSkill';

/** Feature availability used when resolving an unqualified connector identifier. */
export interface ConnectorCatalogAvailability {
  /** Whether Composio-backed connectors may be selected. */
  composio: boolean;
  /** Whether LobeHub Market connectors may be selected. */
  lobehub: boolean;
}

/** A connector definition with its owning authorization system attached. */
export type ConnectorCatalogItem =
  | { provider: LobehubSkillProviderType; type: 'lobehub' }
  | { serverType: ComposioAppType; type: 'composio' };

/**
 * Resolves the owner of an unqualified connector identifier.
 *
 * Use when:
 * - A generic connector surface only stores an identifier such as `github`
 * - LobeHub and Composio catalogs may contain the same identifier
 *
 * Expects:
 * - Explicitly source-qualified flows use their declared source instead
 * - LobeHub owns collisions even when its connector integration is unavailable
 *
 * Returns:
 * - The single connector definition that generic product surfaces should render
 */
export const resolveConnectorCatalogItem = (
  identifier: string,
  availability: ConnectorCatalogAvailability,
): ConnectorCatalogItem | undefined => {
  const provider = LOBEHUB_SKILL_PROVIDERS.find((item) => item.id === identifier);
  if (provider) return availability.lobehub ? { provider, type: 'lobehub' } : undefined;

  if (availability.composio) {
    const serverType = COMPOSIO_APP_TYPES.find((item) => item.identifier === identifier);
    if (serverType) return { serverType, type: 'composio' };
  }
};

/**
 * Builds the connector catalog for generic, unqualified product surfaces.
 *
 * Use when:
 * - Rendering connector discovery, settings, or agent tool pickers
 * - Every visible identifier must map to exactly one authorization system
 *
 * Expects:
 * - Explicit onboarding/provider registries continue to use their source-qualified catalogs
 *
 * Returns:
 * - LobeHub connectors first, followed by non-conflicting Composio connectors
 */
export const getConnectorCatalog = (
  availability: ConnectorCatalogAvailability,
): ConnectorCatalogItem[] => {
  const identifiers = new Set(LOBEHUB_SKILL_PROVIDERS.map((provider) => provider.id));
  const catalog: ConnectorCatalogItem[] = [];

  if (availability.lobehub) {
    for (const provider of LOBEHUB_SKILL_PROVIDERS) {
      catalog.push({ provider, type: 'lobehub' });
    }
  }

  if (availability.composio) {
    for (const serverType of COMPOSIO_APP_TYPES) {
      if (identifiers.has(serverType.identifier)) continue;
      identifiers.add(serverType.identifier);
      catalog.push({ serverType, type: 'composio' });
    }
  }

  return catalog;
};
