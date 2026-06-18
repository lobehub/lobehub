'use client';

import type { ModalInstance } from '@lobehub/ui/base-ui';
import { createModal } from '@lobehub/ui/base-ui';
import type { FormInstance } from 'antd';
import { t } from 'i18next';

import CreateNewModelContent from './Content';
import CreateNewModelFooter from './Footer';

interface CreateNewModelModalOptions {
  existingModelIds?: string[];
  showDeployName?: boolean;
}

export const createCreateNewModelModal = (
  options: CreateNewModelModalOptions = {},
): ModalInstance => {
  const formRef: { current?: FormInstance } = {};

  return createModal({
    content: (
      <CreateNewModelContent
        existingModelIds={options.existingModelIds}
        showDeployName={options.showDeployName}
        onFormReady={(instance) => {
          formRef.current = instance;
        }}
      />
    ),
    footer: <CreateNewModelFooter formRef={formRef} />,
    maskClosable: true,
    title: t('providerModels.createNew.title', { ns: 'modelProvider' }),
    width: 'min(90vw, 640px)',
  });
};
