'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import DatasetImportContent, { type DatasetImportContentProps } from './Content';

export const createDatasetImportModal = (props: DatasetImportContentProps): ModalInstance =>
  createModal({
    content: <DatasetImportContent {...props} />,
    footer: null,
    maskClosable: false,
    styles: {
      content: { padding: 0 },
    },
    title: t('dataset.import.title', { ns: 'eval' }),
    width: 720,
  });
