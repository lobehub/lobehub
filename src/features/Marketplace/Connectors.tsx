'use client';

import { ToolSettings } from '@/features/Settings/skill';

import CatalogViewTabs from './CatalogViewTabs';

/**
 * `/marketplace/connector/installed`: the connector manager (formerly
 * `/settings/connector`), the Installed half of the merged Connectors entry.
 */
const Connectors = () => (
  <ToolSettings
    headerExtra={<CatalogViewTabs inset active={'installed'} kind={'connector'} />}
    viewMode="connector"
  />
);

Connectors.displayName = 'MarketplaceConnectors';

export default Connectors;
