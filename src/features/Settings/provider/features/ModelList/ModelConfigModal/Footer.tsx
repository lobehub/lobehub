'use client';

import { Button, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { type FormInstance } from '@lobehub/ui/base-ui/form';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useModelConfigSave } from './useModelConfigSave';

interface ModelConfigFooterProps {
  formRef: { current?: FormInstance };
  id: string;
}

const ModelConfigFooter = memo<ModelConfigFooterProps>(({ formRef, id }) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const { loading, save } = useModelConfigSave({ formRef, id });

  return (
    <ModalFooter>
      <Button onClick={close}>{t('cancel')}</Button>
      <Button loading={loading} type="primary" onClick={save}>
        {t('ok')}
      </Button>
    </ModalFooter>
  );
});

export default ModelConfigFooter;
