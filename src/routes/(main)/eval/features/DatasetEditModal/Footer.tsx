'use client';

import { Button } from '@lobehub/ui';
import { ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface FooterProps {
  formId: string;
  loading: boolean;
}

const DatasetEditFooter: FC<FooterProps> = ({ formId, loading }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  return (
    <ModalFooter>
      <Button disabled={loading} onClick={close}>
        {t('common.cancel')}
      </Button>
      <Button form={formId} htmlType="submit" loading={loading} type="primary">
        {t('common.update')}
      </Button>
    </ModalFooter>
  );
};

export default DatasetEditFooter;
