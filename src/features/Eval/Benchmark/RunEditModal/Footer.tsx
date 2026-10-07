'use client';

import { Button, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface FooterProps {
  formId: string;
  loading: boolean;
}

const RunEditFooter: FC<FooterProps> = ({ formId, loading }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  return (
    <ModalFooter>
      <Button disabled={loading} onClick={close}>
        {t('common.cancel')}
      </Button>
      <Button form={formId} htmlType="submit" loading={loading} type="primary">
        {t('benchmark.edit.confirm')}
      </Button>
    </ModalFooter>
  );
};

export default RunEditFooter;
