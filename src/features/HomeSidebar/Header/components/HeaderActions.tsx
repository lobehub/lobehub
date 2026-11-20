'use client';

import { ActionIcon } from '@lobehub/ui';
import { SquarePenIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useNavLayout } from '@/hooks/useNavLayout';
import { useHeaderActionSize } from '@/styles/density';

import { resolveHeaderItems } from '../headerItems';

const HeaderActions = () => {
  const headerActionSize = useHeaderActionSize(true);
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const { topNavItems } = useNavLayout();
  const { search } = resolveHeaderItems(topNavItems);

  return (
    <>
      {search && (
        <ActionIcon
          aria-label={search.title}
          icon={search.icon}
          size={headerActionSize}
          title={search.title}
          onClick={search.onClick}
        />
      )}
      <ActionIcon
        aria-label={t('navPanel.newChat')}
        icon={SquarePenIcon}
        size={headerActionSize}
        title={t('navPanel.newChat')}
        onClick={() => navigate('/')}
      />
    </>
  );
};

export default HeaderActions;
