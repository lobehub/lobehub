import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { sandboxStorageService } from '@/services/sandboxStorage';

import type { SandboxSelection } from './useSandboxPlacement';

const folderName = (path: string) => path.split('/').pop() || path;

/**
 * The folder of a selection — its path on the drive and what it is called: the
 * root, or its last segment. A legacy environment directory is a folder like
 * any other now, named after its directory on the drive.
 */
export const useSandboxFolder = (selection: SandboxSelection, entitled: boolean) => {
  const { t } = useTranslation('chat');
  // A legacy environment directory's own row, for its path — from the
  // database, so the menu never waits on a sandbox.
  const { data: instance } = useSWR(
    entitled && selection.instanceId ? ['sandbox-drive-chip-instance', selection.instanceId] : null,
    () => sandboxStorageService.getInstance({ id: selection.instanceId! }),
  );
  const directory = selection.instanceId ? instance?.workingDirectory : selection.workingDirectory;
  const label =
    directory === '.' ? t('sandboxDrive.root') : directory ? folderName(directory) : undefined;
  return { label, path: directory };
};
