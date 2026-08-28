'use client';

import { isDesktop } from '@lobechat/const';
import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { BrainCircuit } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

export const ManageMemoryButton = () => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();

  // The `/memory` manager route is registered in the desktop router only.
  if (!isDesktop) return null;

  return (
    <Button
      icon={<Icon icon={BrainCircuit} />}
      size={'small'}
      onClick={() => navigate('/memory', { escape: true })}
    >
      {t('memory.manageEntry')}
    </Button>
  );
};
