'use client';

import { Button, type ButtonProps, Icon } from '@lobehub/ui';
import { ChartPieIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SANDBOX_STORAGE_CLEANUP_PATH, SANDBOX_STORAGE_PATH } from '@/features/ResourceHome/paths';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * On the storage page itself, the drive tab being viewed is the one to
 * clean up; anywhere else the page picks its default drive.
 */
const cleanupPathFromHere = () => {
  const { pathname, search } = window.location;
  const drive = pathname.includes(SANDBOX_STORAGE_PATH)
    ? new URLSearchParams(search).get('drive')
    : null;
  return drive
    ? `${SANDBOX_STORAGE_CLEANUP_PATH}&drive=${encodeURIComponent(drive)}`
    : SANDBOX_STORAGE_CLEANUP_PATH;
};

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
        onClick={() => navigate(cleanupPathFromHere())}
      >
        {t('drive.cleanup.open')}
      </Button>
    );
  },
);

CleanupEntryButton.displayName = 'SandboxDriveCleanupEntryButton';

export default CleanupEntryButton;
