'use client';

import { Button, Icon } from '@lobehub/ui';
import { HardDriveUpload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useExportAllData } from './useExportAllData';

interface ExportAllDataButtonProps {
  disabled?: boolean;
}

/**
 * Exports all data of the current account or workspace. The button stays loading, and ignores
 * clicks, until the export settles.
 */
const ExportAllDataButton = ({ disabled }: ExportAllDataButtonProps) => {
  const { t } = useTranslation('setting');
  const { exportAllData, exporting } = useExportAllData();

  return (
    <Button
      disabled={disabled}
      icon={<Icon icon={HardDriveUpload} />}
      loading={exporting}
      onClick={exportAllData}
    >
      {t('storage.actions.export.button')}
    </Button>
  );
};

export default ExportAllDataButton;
