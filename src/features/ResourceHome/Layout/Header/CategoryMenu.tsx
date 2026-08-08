'use client';

import { Flexbox } from '@lobehub/ui';
import {
  ClipboardListIcon,
  FilesIcon,
  FileText,
  HouseIcon,
  ImageIcon,
  LayoutPanelTopIcon,
  Mic2,
  SquarePlay,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useBusinessResourceCategories } from '@/business/client/features/ResourceCategories';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { FilesTabs } from '@/types/files';

const CategoryMenu = memo(() => {
  const { t } = useTranslation('file');
  const [activeKey, setMode] = useResourceManagerStore((s) => [s.category, s.setMode]);
  const navigate = useWorkspaceAwareNavigate();
  const businessCategories = useBusinessResourceCategories();
  const location = useActiveLocation();
  // In Work-gallery mode (`?works=`) no file category is selected, so suppress
  // the category highlight — otherwise "All" reads as active alongside the
  // active Work entry.
  const worksActive = new URLSearchParams(location.search).has('works');

  const items = useMemo(
    () => [
      {
        icon: HouseIcon,
        key: FilesTabs.Home,
        title: t('tab.home'),
        url: '/resource',
      },
      {
        icon: LayoutPanelTopIcon,
        key: FilesTabs.All,
        title: t('tab.all'),
        url: '/resource/all',
      },
      {
        icon: FileText,
        key: FilesTabs.Documents,
        title: t('tab.documents'),
        url: '/resource/documents',
      },
      {
        icon: ImageIcon,
        key: FilesTabs.Images,
        title: t('tab.images'),
        url: '/resource/images',
      },
      {
        icon: Mic2,
        key: FilesTabs.Audios,
        title: t('tab.audios'),
        url: '/resource/audios',
      },
      {
        icon: SquarePlay,
        key: FilesTabs.Videos,
        title: t('tab.videos'),
        url: '/resource/videos',
      },
      {
        icon: FilesIcon,
        key: FilesTabs.Files,
        title: t('tab.files'),
        url: '/resource/files',
      },
      // Single Works entry (no sub-categories this iteration): switches the
      // content area to the topic-grouped Work gallery via `?works=all`.
      {
        icon: ClipboardListIcon,
        key: 'works',
        title: t('work.group'),
        url: '/resource?works=all',
      },
      ...businessCategories.map((category) => ({
        icon: category.icon,
        isBusiness: true,
        key: category.key,
        // Business categories carry a chat-namespace key but the type narrows to a
        // string at this seam; cast so t() accepts the dynamic key.
        title: t(category.titleKey as never) as string,
        url: category.url,
      })),
    ],
    [t, businessCategories],
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items.map((item) => {
        const isActive =
          item.key === 'works'
            ? worksActive
            : !worksActive &&
              ('isBusiness' in item && item.isBusiness
                ? location.pathname === item.url
                : activeKey === item.key);
        return (
          <Link
            key={item.key}
            to={item.url}
            onClick={(e) => {
              e.preventDefault();
              setMode('explorer');
              navigate(item.url, { replace: true });
            }}
          >
            <NavItem active={isActive} icon={item.icon} title={item.title} />
          </Link>
        );
      })}
    </Flexbox>
  );
});

CategoryMenu.displayName = 'CategoryMenu';

export default CategoryMenu;
