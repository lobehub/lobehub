'use client';

import { ToolSettings } from '@/features/Settings/skill';

import SkillViewTabs from './SkillViewTabs';

/** `/marketplace/skill/installed`: the installed skills manager (formerly `/settings/skill`). */
const InstalledSkills = () => (
  <ToolSettings headerExtra={<SkillViewTabs inset active={'installed'} />} viewMode="skill" />
);

InstalledSkills.displayName = 'MarketplaceInstalledSkills';

export default InstalledSkills;
