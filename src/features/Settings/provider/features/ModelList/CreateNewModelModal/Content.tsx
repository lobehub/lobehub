'use client';

import type { FormInstance } from 'antd';
import { memo } from 'react';

import ModelConfigForm from './Form';

interface CreateNewModelContentProps {
  existingModelIds?: string[];
  onFormReady: (instance: FormInstance) => void;
  showDeployName?: boolean;
}

const CreateNewModelContent = memo<CreateNewModelContentProps>(
  ({ showDeployName, onFormReady, existingModelIds }) => (
    <ModelConfigForm
      existingModelIds={existingModelIds}
      showDeployName={showDeployName}
      onFormInstanceReady={onFormReady}
    />
  ),
);

export default CreateNewModelContent;
