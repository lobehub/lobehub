'use client';

import { type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { createFormModal } from '@/utils/createFormModal';

import BenchmarkEditContent, { type BenchmarkEditContentProps } from './Content';
import BenchmarkEditFooter from './Footer';

type Props = Omit<BenchmarkEditContentProps, 'formId' | 'onLoadingChange'>;

export const createBenchmarkEditModal = (props: Props): ModalInstance =>
  createFormModal({
    renderContent: ({ formId, setLoading }) => (
      <BenchmarkEditContent {...props} formId={formId} onLoadingChange={setLoading} />
    ),
    renderFooter: ({ formId, loading }) => (
      <BenchmarkEditFooter formId={formId} loading={loading} />
    ),
    title: t('benchmark.edit.title', { ns: 'eval' }),
    width: 480,
  });
