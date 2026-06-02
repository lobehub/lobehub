'use client';

import { Button } from '@lobehub/ui';
import { ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface FooterProps {
  formId: string;
  loading: boolean;
}

const DatasetCreateFooter: FC<FooterProps> = ({ formId, loading }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  return (
    <ModalFooter>
      <Button disabled={loading} onClick={close}>
        {t('common.cancel')}
      </Button>
      <Button form={formId} htmlType="submit" loading={loading} type="primary">
        {t('common.create')}
      </Button>
    </ModalFooter>
  );
};

export default DatasetCreateFooter;
