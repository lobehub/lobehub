'use client';

import { Button, type ButtonProps, Icon } from '@lobehub/ui';
import { ChartPieIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SANDBOX_STORAGE_CLEANUP_PATH } from '@/features/ResourceHome/paths';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * The way out of a full drive, wherever its refusal is shown: the storage
 * page, opened on its space analysis and cleanup.
 */
const CleanupEntryButton = memo<Pick<ButtonProps, 'size' | 'type'>>(
  ({ size = 'small', type = 'primary' }) => {
    const { t } = useTranslation('setting');
    const navigate = useWorkspaceAwareNavigate();

    return (
      <Button
        icon={<Icon icon={ChartPieIcon} />}
        size={size}
        type={type}
        onClick={() => navigate(SANDBOX_STORAGE_CLEANUP_PATH)}
      >
        {t('drive.cleanup.open')}
      </Button>
    );
  },
);

CleanupEntryButton.displayName = 'SandboxDriveCleanupEntryButton';

export default CleanupEntryButton;
