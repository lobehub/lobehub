import urlJoin from 'url-join';

import { discoverService } from '@/services/discover';
import type { AssistantMarketSource } from '@/types/discover';

import { buildCatalogListUrl } from '../Catalog/sections';
import { useCatalogDetailNavigate } from '../Catalog/useCatalogDetailNavigate';
import { MARKETPLACE_AGENT_PATH, MARKETPLACE_PATH } from '../paths';

/** Opens a Marketplace Agent's page, remembering the catalog view it was opened from. */
export const useOpenAgent = (source?: AssistantMarketSource) => {
  const navigate = useCatalogDetailNavigate();
  return (identifier: string, isGroup = false) => {
    discoverService
      .reportAgentEvent({ event: 'click', identifier, source: location.pathname })
      .catch(() => {});
    const base = isGroup ? `${MARKETPLACE_PATH}/group_agent` : MARKETPLACE_AGENT_PATH;
    navigate(buildCatalogListUrl(urlJoin(base, identifier), { source }));
  };
};
