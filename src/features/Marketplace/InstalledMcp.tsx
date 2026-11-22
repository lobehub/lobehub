import { ToolSettings } from '@/features/Settings/skill';

import CatalogViewTabs from './CatalogViewTabs';

export default function InstalledMcp() {
  return (
    <ToolSettings
      headerExtra={<CatalogViewTabs inset active={'installed'} kind={'mcp'} />}
      viewMode={'mcp'}
    />
  );
}
