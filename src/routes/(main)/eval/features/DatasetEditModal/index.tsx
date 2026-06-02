'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import DatasetEditContent, { type DatasetEditContentProps } from './Content';

export const createDatasetEditModal = (props: DatasetEditContentProps): ModalInstance =>
  createModal({
    content: <DatasetEditContent {...props} />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title: t('dataset.edit.title', { ns: 'eval' }),
    width: 480,
  });
