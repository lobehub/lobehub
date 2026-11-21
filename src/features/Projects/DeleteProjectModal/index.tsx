'use client';

import { createModal, type ModalInstance } from '@lobehub/ui';
import { t } from 'i18next';

import { Content } from './Content';

interface CreateDeleteProjectModalOptions {
  /** Runs the delete; a rejection keeps the modal open and shows the error. */
  onConfirm: () => Promise<void>;
  project: { id: string; name: string };
}

export const createDeleteProjectModal = (options: CreateDeleteProjectModalOptions): ModalInstance =>
  createModal({
    content: <Content project={options.project} onConfirm={options.onConfirm} />,
    footer: null,
    maskClosable: false,
    styles: {
      content: { padding: 0 },
    },
    title: t('delete.confirm.title', { ns: 'project' }),
    width: 'min(92vw, 520px)',
  });
