'use client';

import { Button, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { type FormInstance } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';

interface ModelConfigFooterProps {
  formRef: { current?: FormInstance };
  id: string;
}

const ModelConfigFooter = memo<ModelConfigFooterProps>(({ formRef, id }) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const [loading, setLoading] = useState(false);
  const [editingProvider, updateAiModelsConfig] = useAiInfraStore((s) => [
    s.activeAiProvider!,
    s.updateAiModelsConfig,
  ]);

  return (
    <ModalFooter>
      <Button onClick={close}>{t('cancel')}</Button>
      <Button
        loading={loading}
        type="primary"
        onClick={async () => {
          const form = formRef.current;
          if (!editingProvider || !id || !form) return;
          const data = form.getFieldsValue();

          setLoading(true);
          await updateAiModelsConfig(id, editingProvider, data);
          setLoading(false);

          close();
        }}
      >
        {t('ok')}
      </Button>
    </ModalFooter>
  );
});

export default ModelConfigFooter;
