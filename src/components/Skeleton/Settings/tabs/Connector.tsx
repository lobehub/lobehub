'use client';

import { SkillNavListSkeleton } from './Skill';
import { SkillCatalogPageSkeleton } from './SkillCatalog';
import type { SettingsTabSkeleton } from './types';

/** Mobile keeps the nav list, whose groups are the connector types. */
const Body = () => (
  <SkillNavListSkeleton
    fullWidth
    titleKey={'skillView.connectors'}
    sections={[
      { key: 'skillGroup.builtinTools', rows: 5 },
      { key: 'skillGroup.communityConnectors', rows: 4 },
    ]}
  />
);

const Page = () => <SkillCatalogPageSkeleton viewMode={'connector'} />;

const ConnectorSkeleton: SettingsTabSkeleton = { Body, Page };

export default ConnectorSkeleton;
