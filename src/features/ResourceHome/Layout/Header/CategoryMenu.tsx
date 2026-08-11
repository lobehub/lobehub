'use client';

import { Flexbox } from '@lobehub/ui';
import {
  ClipboardListIcon,
  FilePenIcon,
  FilesIcon,
  FileText,
  HouseIcon,
  ImageIcon,
  type LucideIcon,
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

interface CategoryItem {
  icon: LucideIcon;
  isBusiness?: boolean;
  key: string;
  title: string;
  url: string;
}

const CategoryMenu = memo(() => {
  const { t } = useTranslation('file');
  const [activeKey, setMode] = useResourceManagerStore((s) => [s.category, s.setMode]);
  const navigate = useWorkspaceAwareNavigate();
  const businessCategories = useBusinessResourceCategories();
  const location = useActiveLocation();
  // In Work-gallery mode (/resource/works) no file category is selected, so
  // suppress the category highlight — otherwise "Home" reads as active
  // alongside the active Work entry. Match by suffix: the pathname may carry a
  // workspace prefix.
  const worksActive = location.pathname.endsWith('/resource/works');

  // Two groups below the fixed Home entry: file-based categories (uploaded
  // files by type) and LobeHub business entities (pages, works, webpages),
  // separated by a gap. The flat everything-list stays reachable at
  // /resource/all (the home page's "view all" target) but is not a nav entry —
  // browsing starts from a category, not from an undifferentiated pile.
  const groups = useMemo(
    () => [
      [
        {
          icon: HouseIcon,
          key: FilesTabs.Home,
          title: t('tab.home'),
          url: '/resource',
        },
      ],
      // file-based categories — Files (the misc raw-data bucket) sits last
      [
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
          icon: SquarePlay,
          key: FilesTabs.Videos,
          title: t('tab.videos'),
          url: '/resource/videos',
        },
        {
          icon: Mic2,
          key: FilesTabs.Audios,
          title: t('tab.audios'),
          url: '/resource/audios',
        },
        {
          icon: FilesIcon,
          key: FilesTabs.Files,
          title: t('tab.files'),
          url: '/resource/files',
        },
      ],
      // LobeHub business entities
      [
        {
          icon: FilePenIcon,
          key: FilesTabs.Pages,
          title: t('tab.pages'),
          url: '/resource/page',
        },
        {
          icon: ClipboardListIcon,
          key: 'works',
          title: t('work.group'),
          url: '/resource/works',
        },
        // The Websites entry is hidden for now (the category route and the
        // reading-card view stay reachable at /resource/websites) — re-add it
        // here once web clippings ship as a first-class flow.
        ...businessCategories.map((category) => ({
          icon: category.icon,
          isBusiness: true,
          key: category.key,
          // Business categories carry a chat-namespace key but the type narrows to a
          // string at this seam; cast so t() accepts the dynamic key.
          title: t(category.titleKey as never) as string,
          url: category.url,
        })),
      ] as CategoryItem[],
    ],
    [t, businessCategories],
  );

  return (
    <Flexbox gap={12} paddingInline={4}>
      {groups.map((group, groupIndex) => (
        <Flexbox gap={1} key={groupIndex}>
          {group.map((item) => {
            const isActive =
              item.key === 'works'
                ? worksActive
                : !worksActive &&
                  (item.isBusiness ? location.pathname === item.url : activeKey === item.key);
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
      ))}
    </Flexbox>
  );
});

CategoryMenu.displayName = 'CategoryMenu';

export default CategoryMenu;
