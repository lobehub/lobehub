'use client';

import { ToolSettings } from '@/features/Settings/skill';

import CatalogViewTabs from './CatalogViewTabs';

/** `/marketplace/skill/installed`: the installed skills manager (formerly `/settings/skill`). */
const InstalledSkills = () => (
  <ToolSettings
    headerExtra={<CatalogViewTabs inset active={'installed'} kind={'skill'} />}
    viewMode="skill"
  />
);

InstalledSkills.displayName = 'MarketplaceInstalledSkills';

export default InstalledSkills;
