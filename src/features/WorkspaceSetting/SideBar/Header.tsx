'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { HomeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

const Header = memo(() => {
  const { t } = useTranslation('setting');
  const activeWorkspace = useActiveWorkspace();
  const slug = activeWorkspace?.slug;
  const name = activeWorkspace?.name ?? slug;

  if (!slug) return null;

  return (
    <SideBarHeaderLayout
      breadcrumb={[
        {
          href: `/${slug}/settings`,
          title: t('workspaceSetting.breadcrumb.settings'),
        },
      ]}
      homeItem={{
        href: `/${slug}`,
        title: (
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon icon={HomeIcon} size={14} />
            <span>{name}</span>
          </Flexbox>
        ),
      }}
    />
  );
});

export default Header;
