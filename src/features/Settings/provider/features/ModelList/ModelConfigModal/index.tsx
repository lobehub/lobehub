'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { type FormInstance } from '@lobehub/ui/base-ui/form';
import { t } from 'i18next';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { createComfyUIWorkflowModal } from '../ComfyUIWorkflowModal';
import ModelConfigContent from './Content';
import ModelConfigFooter from './Footer';

interface ModelConfigModalOptions {
  id: string;
  showDeployName?: boolean;
}

export const createModelConfigModal = (options: ModelConfigModalOptions): ModalInstance => {
  const state = useAiInfraStore.getState();
  const model = aiModelSelectors.getAiModelById(options.id)(state);
  if (state.activeAiProvider === 'comfyui' && model?.config?.comfyuiWorkflow) {
    return createComfyUIWorkflowModal(model);
  }

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
