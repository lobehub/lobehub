'use client';

import { ToolSettings } from '@/features/Settings/skill';

/** `/marketplace/connector`: the connector manager (formerly `/settings/connector`). */
const Connectors = () => <ToolSettings viewMode="connector" />;

Connectors.displayName = 'MarketplaceConnectors';

export default Connectors;
