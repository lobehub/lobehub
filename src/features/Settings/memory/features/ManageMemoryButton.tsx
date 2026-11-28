'use client';

import { Button, Icon } from '@lobehub/ui';
import { BrainCircuit } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/** Mobile's way into the memory pages; desktop lists them in the settings sidebar. */
export const ManageMemoryButton = () => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();

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
