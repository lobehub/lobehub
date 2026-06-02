'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import CreateBenchmarkContent from './Content';

export const createCreateBenchmarkModal = (): ModalInstance =>
  createModal({
    content: <CreateBenchmarkContent />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title: t('benchmark.create.title', { ns: 'eval' }),
    width: 480,
  });
