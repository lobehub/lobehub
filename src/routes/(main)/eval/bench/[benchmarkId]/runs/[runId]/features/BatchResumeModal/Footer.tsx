'use client';

import { Button, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface FooterProps {
  confirming: boolean;
  onConfirm: () => void;
  selectedCount: number;
}

const BatchResumeFooter: FC<FooterProps> = ({ confirming, onConfirm, selectedCount }) => {
  const { t } = useTranslation('eval');
  const { t: tc } = useTranslation('common');
  const { close } = useModalContext();
  return (
    <ModalFooter>
      <Button disabled={confirming} onClick={close}>
        {tc('cancel')}
      </Button>
      <Button
        disabled={selectedCount === 0}
        loading={confirming}
        type="primary"
        onClick={onConfirm}
      >
        {t('run.actions.batchResume.modal.confirm')} ({selectedCount})
      </Button>
    </ModalFooter>
  );
};

export default BatchResumeFooter;
