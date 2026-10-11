import { toast, useModalContext } from '@lobehub/ui/base-ui';
import { type FormInstance } from '@lobehub/ui/base-ui/form';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';

interface UseModelConfigSaveOptions {
  formRef: { current?: FormInstance };
  id: string;
}

export const useModelConfigSave = ({ formRef, id }: UseModelConfigSaveOptions) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const [loading, setLoading] = useState(false);
  const [editingProvider, updateAiModelsConfig] = useAiInfraStore((s) => [
    s.activeAiProvider!,
    s.updateAiModelsConfig,
  ]);

  const save = async () => {
    const form = formRef.current;
    if (!editingProvider || !id || !form) return;
    const data = form.getValues();

    setLoading(true);
    try {
      await updateAiModelsConfig(id, editingProvider, data);
      close();
    } catch (error) {
      console.error('Failed to save model configuration', error);
      toast.error(t('operationFailed'));
    } finally {
      setLoading(false);
    }
  };

  return { loading, save };
};
