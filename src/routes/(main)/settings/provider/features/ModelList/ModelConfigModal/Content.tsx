'use client';

import { type FormInstance } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import ModelConfigForm from '../CreateNewModelModal/Form';

interface ModelConfigContentProps {
  id: string;
  onFormReady: (instance: FormInstance) => void;
  showDeployName?: boolean;
}

const ModelConfigContent = memo<ModelConfigContentProps>(({ id, showDeployName, onFormReady }) => {
  const model = useAiInfraStore(aiModelSelectors.getAiModelById(id), isEqual);

  return (
    <ModelConfigForm
      idEditable={false}
      initialValues={model}
      showDeployName={showDeployName}
      type={model?.type}
      onFormInstanceReady={onFormReady}
    />
  );
});

export default ModelConfigContent;
