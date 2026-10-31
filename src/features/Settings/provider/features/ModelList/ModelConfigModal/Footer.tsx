'use client';

import { Button, ModalFooter, toast, useModalContext } from '@lobehub/ui';
import { type FormInstance } from '@lobehub/ui/form';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';

import { pickModelConfigFormValues } from './utils';

interface ModelConfigFooterProps {
  formRef: { current?: FormInstance };
  id: string;
  showDeployName?: boolean;
}

const ModelConfigFooter = memo<ModelConfigFooterProps>(({ formRef, id, showDeployName }) => {
  const { t } = useTranslation(['common', 'error']);
  const { close } = useModalContext();
  const [loading, setLoading] = useState(false);
  const [editingProvider, updateAiModelsConfig] = useAiInfraStore((s) => [
    s.activeAiProvider!,
    s.updateAiModelsConfig,
  ]);

  return (
    <ModalFooter>
      <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
      <Button
        loading={loading}
        type="primary"
        onClick={async () => {
          const form = formRef.current;
          if (!editingProvider || !id || !form) return;
          const builtinCard = useAiInfraStore
            .getState()
            .builtinAiModelList.find(
              (item) => item.id === id && item.providerId === editingProvider,
            );
          const data = pickModelConfigFormValues(form.getValues(), {
            cardReasoningEffort: builtinCard?.settings?.reasoningEffort,
            showDeployName,
          });

          setLoading(true);
          try {
            await updateAiModelsConfig(id, editingProvider, data);
            close();
          } catch (error) {
            console.error(error);
            toast.error(t('saveState.saveFailed', { ns: 'error' }));
          } finally {
            setLoading(false);
          }
        }}
      >
        {t('ok', { ns: 'common' })}
      </Button>
    </ModalFooter>
  );
});

export default ModelConfigFooter;
