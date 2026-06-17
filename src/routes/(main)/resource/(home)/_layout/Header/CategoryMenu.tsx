'use client';

import { Flexbox } from '@lobehub/ui';
import { FileText, ImageIcon, LayoutPanelTopIcon, Mic2, SquarePlay } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { useBusinessResourceCategories } from '@/business/client/features/ResourceCategories';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { FilesTabs } from '@/types/files';

import { useResourceManagerStore } from '../../../features/store';

const CategoryMenu = memo(() => {
  const { t } = useTranslation('file');
  const [activeKey, setMode] = useResourceManagerStore((s) => [s.category, s.setMode]);
  const navigate = useWorkspaceAwareNavigate();
  const businessCategories = useBusinessResourceCategories();
  const location = useLocation();

  const items = useMemo(
    () => [
      {
        icon: LayoutPanelTopIcon,
        key: FilesTabs.All,
        title: t('tab.all'),
        url: '/resource',
      },
      {
        icon: FileText,
        key: FilesTabs.Documents,
        title: t('tab.documents'),
        url: '/resource?category=documents',
      },
      {
        icon: ImageIcon,
        key: FilesTabs.Images,
        title: t('tab.images'),
        url: '/resource?category=images',
      },
      {
        icon: Mic2,
        key: FilesTabs.Audios,
        title: t('tab.audios'),
        url: '/resource?category=audios',
      },
      {
        icon: SquarePlay,
        key: FilesTabs.Videos,
        title: t('tab.videos'),
        url: '/resource?category=videos',
      },
      ...businessCategories.map((category) => ({
        icon: category.icon,
        key: category.key,
        title: t(category.titleKey),
        url: category.url,
      })),
    ],
    [t, businessCategories],
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items.map((item) => {
        const isBusinessRoute = item.url.startsWith('/resource/');
        const isActive = isBusinessRoute ? location.pathname === item.url : activeKey === item.key;
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
