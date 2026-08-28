'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { type FormInstance } from 'antd';
import { t } from 'i18next';

import ModelConfigContent from './Content';
import ModelConfigFooter from './Footer';

interface ModelConfigModalOptions {
  id: string;
  showDeployName?: boolean;
}

export const createModelConfigModal = (options: ModelConfigModalOptions): ModalInstance => {
  const formRef: { current?: FormInstance } = {};

  return createModal({
    content: (
      <ModelConfigContent
        id={options.id}
        showDeployName={options.showDeployName}
        onFormReady={(instance) => {
          formRef.current = instance;
        }}
      />
    ),
    footer: <ModelConfigFooter formRef={formRef} id={options.id} />,
    maskClosable: true,
    title: t('llm.customModelCards.modelConfig.modalTitle', { ns: 'setting' }),
    width: 'min(90vw, 640px)',
  });
};
