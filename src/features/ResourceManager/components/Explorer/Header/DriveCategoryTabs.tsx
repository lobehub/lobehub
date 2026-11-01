'use client';

import { Segmented } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { driveCategoryPath } from '@/features/ResourceHome/paths';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { FilesTabs } from '@/types/files';

/** File types the drive filters by; `Files` (the misc raw-data bucket) sits last. */
const DRIVE_CATEGORIES = [
  FilesTabs.All,
  FilesTabs.Documents,
  FilesTabs.Images,
  FilesTabs.Videos,
  FilesTabs.Audios,
  FilesTabs.Files,
] as const;

/**
 * The drive's file-type switch. It lives in the content header rather than the
 * sidebar so the sidebar keeps only the four Docs sections.
 */
const DriveCategoryTabs = memo(() => {
  const { t } = useTranslation('file');
  const [category, setMode] = useResourceManagerStore((s) => [s.category, s.setMode]);
  const navigate = useWorkspaceAwareNavigate();

  const options = useMemo(
    () =>
      DRIVE_CATEGORIES.map((value) => ({
        label: value === FilesTabs.All ? t('docs.drive.all') : t(`tab.${value}`),
        value,
      })),
    [t],
  );

  return (
    <Segmented
      options={options}
      size={'small'}
      value={category}
      onChange={(value) => {
        setMode('explorer');
        navigate(driveCategoryPath(value as FilesTabs), { replace: true });
      }}
    />
  );
});

DriveCategoryTabs.displayName = 'DriveCategoryTabs';

export default DriveCategoryTabs;
