'use client';

import { Button } from '@lobehub/ui';
import { ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import type { FormInstance } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';

interface CreateNewModelFooterProps {
  formRef: { current?: FormInstance };
}

const CreateNewModelFooter = memo<CreateNewModelFooterProps>(({ formRef }) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const [loading, setLoading] = useState(false);
  const [editingProvider, createNewAiModel] = useAiInfraStore((s) => [
    s.activeAiProvider!,
    s.createNewAiModel,
  ]);

  return (
    <ModalFooter>
      <Button onClick={close}>{t('cancel')}</Button>
      <Button
        loading={loading}
        type="primary"
        onClick={async () => {
          const form = formRef.current;
          if (!editingProvider || !form) return;

          setLoading(true);

          try {
            await form.validateFields();
            const data = form.getFieldsValue();
            await createNewAiModel({ ...data, providerId: editingProvider });
            setLoading(false);
            close();
          } catch {
            setLoading(false);
          }
        }}
      >
        {t('ok')}
      </Button>
    </ModalFooter>
  );
});

export default CreateNewModelFooter;
