'use client';

import { Flexbox } from '@lobehub/ui';
import {
  ClipboardListIcon,
  HardDriveIcon,
  HouseIcon,
  LibraryBigIcon,
  type LucideIcon,
  ServerIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useBusinessResourceCategories } from '@/business/client/features/ResourceCategories';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import {
  type DocsSection,
  DRIVE_PATH,
  LIBRARY_INDEX_PATH,
  resolveDocsSection,
  RESOURCE_HOME_PATH,
  SANDBOX_STORAGE_PATH,
  WORKS_PATH,
} from '../../paths';

interface SectionItem {
  icon: LucideIcon;
  key: DocsSection;
  title: string;
  url: string;
}

/**
 * The Docs sections. Each owns a clearly separate pool — recent activity,
 * every uploaded file, the cloud sandbox's drives, libraries, Agent output —
 * instead of one mixed list of file types, libraries and business entities.
 */
const CategoryMenu = memo(() => {
  const { t } = useTranslation('file');
  const setMode = useResourceManagerStore((s) => s.setMode);
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();
  // The real href carries the workspace prefix too, so a middle-click or
  // "open in new tab" stays in the same workspace as a plain click.
  const workspaceSlug = useActiveWorkspaceSlug();
  // Business Works types keep their own routes but belong to Works.
  const businessCategories = useBusinessResourceCategories();
  const activeSection = resolveDocsSection(
    location.pathname,
    businessCategories.map((category) => category.url),
  );

  // A workspace always has sandbox drives; a personal account has one only
  // where the drive service runs — a self-hosted deployment has none.
  const workspaceId = useActiveWorkspaceId();
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const showSandboxStorage = !!workspaceId || enableBusinessFeatures;

  const items = useMemo<SectionItem[]>(
    () => [
      { icon: HouseIcon, key: 'home', title: t('docs.section.home'), url: RESOURCE_HOME_PATH },
      { icon: HardDriveIcon, key: 'drive', title: t('docs.section.drive'), url: DRIVE_PATH },
      ...(showSandboxStorage
        ? [
            {
              icon: ServerIcon,
              key: 'sandboxStorage' as const,
              title: t('docs.section.sandboxStorage'),
              url: SANDBOX_STORAGE_PATH,
            },
          ]
        : []),
      {
        icon: LibraryBigIcon,
        key: 'library',
        title: t('docs.section.library'),
        url: LIBRARY_INDEX_PATH,
      },
      { icon: ClipboardListIcon, key: 'works', title: t('docs.section.works'), url: WORKS_PATH },
    ],
    [showSandboxStorage, t],
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items.map((item) => (
        <Link
          key={item.key}
          to={buildWorkspaceAwarePath(item.url, workspaceSlug)}
          onClick={(e) => {
            e.preventDefault();
            setMode('explorer');
            navigate(item.url);
          }}
        >
          <NavItem active={activeSection === item.key} icon={item.icon} title={item.title} />
        </Link>
      ))}
    </Flexbox>
  );
});

CategoryMenu.displayName = 'CategoryMenu';

export default CategoryMenu;
