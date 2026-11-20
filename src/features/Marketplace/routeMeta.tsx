import { Blocks, ShapesIcon } from 'lucide-react';

import { SkillCatalogPageSkeleton } from '@/components/Skeleton/Settings/tabs/SkillCatalog';
import { routeMeta } from '@/spa/router/routeMeta';

/**
 * The installed-skill and connector managers draw their own page frame, so the
 * route skeleton is their whole-page shape (the same one the settings tabs used
 * before moving here), not the Marketplace list chrome.
 */
const InstalledSkillsSkeleton = () => <SkillCatalogPageSkeleton viewMode={'skill'} />;
const ConnectorsSkeleton = () => <SkillCatalogPageSkeleton viewMode={'connector'} />;

export const marketplaceInstalledSkillsRouteMeta = routeMeta({
  icon: ShapesIcon,
  Skeleton: InstalledSkillsSkeleton,
  titleKey: 'navigation.marketplaceInstalledSkills',
});

export const marketplaceConnectorsRouteMeta = routeMeta({
  icon: Blocks,
  Skeleton: ConnectorsSkeleton,
  titleKey: 'navigation.marketplaceConnectors',
});
