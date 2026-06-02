'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import RunCreateContent, { type RunCreateContentProps } from './Content';

export const createRunCreateModal = (props: RunCreateContentProps): ModalInstance =>
  createModal({
    content: <RunCreateContent {...props} />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title:
      props.datasetId && props.datasetName
        ? t('run.create.titleWithDataset', { dataset: props.datasetName, ns: 'eval' })
        : t('run.create.title', { ns: 'eval' }),
    width: 520,
  });
