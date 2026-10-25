'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import type { AiProviderModelListItem } from 'model-bank';

import { ComfyUIWorkflowContent } from './Content';

export const createComfyUIWorkflowModal = (model?: AiProviderModelListItem) =>
  createModal({
    content: <ComfyUIWorkflowContent model={model} />,
    footer: null,
    maskClosable: false,
    styles: { content: { overflow: 'hidden', padding: 0 } },
    title: t(model ? 'comfyui.workflow.edit' : 'comfyui.workflow.import', {
      ns: 'modelProvider',
    }),
    width: 'min(94vw, 900px)',
  });
