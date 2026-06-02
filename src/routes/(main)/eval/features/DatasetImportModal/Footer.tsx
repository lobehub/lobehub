'use client';

import { Button } from '@lobehub/ui';
import { ModalFooter } from '@lobehub/ui/base-ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface FooterProps {
  canImport: boolean;
  importing: boolean;
  onImport: () => void;
  onPrev: () => void;
}

const DatasetImportFooter: FC<FooterProps> = ({ canImport, importing, onImport, onPrev }) => {
  const { t } = useTranslation('eval');
  return (
    <ModalFooter>
      <Button disabled={importing} onClick={onPrev}>
        {t('dataset.import.prev')}
      </Button>
      <Button disabled={!canImport} loading={importing} type="primary" onClick={onImport}>
        {t('dataset.import.confirm')}
      </Button>
    </ModalFooter>
  );
};

export default DatasetImportFooter;
