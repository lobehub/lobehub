'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import BatchResumeContent, { type BatchResumeContentProps } from './Content';

export const createBatchResumeModal = (props: BatchResumeContentProps): ModalInstance =>
  createModal({
    content: <BatchResumeContent {...props} />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title: t('run.actions.batchResume.modal.title', { ns: 'eval' }),
    width: 700,
  });
