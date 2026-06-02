'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import BenchmarkEditContent, { type BenchmarkEditContentProps } from './Content';

export const createBenchmarkEditModal = (props: BenchmarkEditContentProps): ModalInstance =>
  createModal({
    content: <BenchmarkEditContent {...props} />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title: t('benchmark.edit.title', { ns: 'eval' }),
    width: 480,
  });
