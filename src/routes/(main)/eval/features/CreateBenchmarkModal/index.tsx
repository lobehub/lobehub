'use client';

import { type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { createFormModal } from '@/utils/createFormModal';

import CreateBenchmarkContent from './Content';
import CreateBenchmarkFooter from './Footer';

export const createCreateBenchmarkModal = (): ModalInstance =>
  createFormModal({
    renderContent: ({ formId, setLoading }) => (
      <CreateBenchmarkContent formId={formId} onLoadingChange={setLoading} />
    ),
    renderFooter: ({ formId, loading }) => (
      <CreateBenchmarkFooter formId={formId} loading={loading} />
    ),
    title: t('benchmark.create.title', { ns: 'eval' }),
    width: 480,
  });
