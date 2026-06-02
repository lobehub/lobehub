'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import DatasetCreateContent, { type DatasetCreateContentProps } from './Content';

export const createDatasetCreateModal = (props: DatasetCreateContentProps): ModalInstance =>
  createModal({
    content: <DatasetCreateContent {...props} />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title: t('dataset.create.title', { ns: 'eval' }),
    width: 600,
  });
