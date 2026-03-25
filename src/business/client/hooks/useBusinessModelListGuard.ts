import { Modal } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { usageService } from '@/services/usage';
import { AUTO_MODEL_ID, canAccessModel } from '@/utils/modelAccess';

export interface BusinessModelListGuard {
  isModelRestricted?: (modelId: string, providerId: string) => boolean;
  onRestrictedModelClick?: () => void;
}

export const useBusinessModelListGuard = (): BusinessModelListGuard => {
  const { t } = useTranslation('components');
  const { data } = useClientDataSWR('my-advanced-model-access', () =>
    usageService.getMyAdvancedModelAccess(),
  );

  const isModelRestricted = useCallback(
    (modelId: string, providerId: string) => {
      if (modelId === AUTO_MODEL_ID) return false;
      return !canAccessModel(data || [], providerId, modelId);
    },
    [data],
  );

  const onRestrictedModelClick = useCallback(() => {
    Modal.warning({
      centered: true,
      content: t('ModelSwitchPanel.advancedModelApply.content'),
      okText: t('ModelSwitchPanel.advancedModelApply.ok'),
      title: t('ModelSwitchPanel.advancedModelApply.title'),
    });
  }, [t]);

  return { isModelRestricted, onRestrictedModelClick };
};
