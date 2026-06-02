'use client';

import { type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { createFormModal } from '@/utils/createFormModal';

import DatasetCreateContent, { type DatasetCreateContentProps } from './Content';
import DatasetCreateFooter from './Footer';

type Props = Omit<DatasetCreateContentProps, 'formId' | 'onLoadingChange'>;

export const createDatasetCreateModal = (props: Props): ModalInstance =>
  createFormModal({
    renderContent: ({ formId, setLoading }) => (
      <DatasetCreateContent {...props} formId={formId} onLoadingChange={setLoading} />
    ),
    renderFooter: ({ formId, loading }) => (
      <DatasetCreateFooter formId={formId} loading={loading} />
    ),
    title: t('dataset.create.title', { ns: 'eval' }),
    width: 600,
  });
