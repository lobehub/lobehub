'use client';

import { isDesktop } from '@lobechat/const';
import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { BrainCircuit } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import Memory from './features/Memory';

const Page = () => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  return (
    <>
      <SettingHeader
        title={t('tab.memory')}
        // Config and management live on separate surfaces — give this settings
        // page the entry to actually view / edit / clear memory that its copy
        // promises, instead of dead-ending at a toggle + slider.
        // Desktop-only: the `/memory` manager route is registered in the desktop
        // router, not the mobile one (mobile renders this same tab via its
        // generic settings route but has no `/memory`). Linking on mobile would
        // hit an unmatched route / blank page.
        extra={
          isDesktop ? (
            <Button
              icon={<Icon icon={BrainCircuit} />}
              size={'small'}
              onClick={() => navigate('/memory', { escape: true })}
            >
              {t('memory.manageEntry')}
            </Button>
          ) : undefined
        }
      />
      <Memory />
    </>
  );
};

export default Page;
