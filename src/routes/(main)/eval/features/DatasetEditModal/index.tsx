'use client';

import { type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { createFormModal } from '@/utils/createFormModal';

import DatasetEditContent, { type DatasetEditContentProps } from './Content';
import DatasetEditFooter from './Footer';

type Props = Omit<DatasetEditContentProps, 'formId' | 'onLoadingChange'>;

export const createDatasetEditModal = (props: Props): ModalInstance =>
  createFormModal({
    renderContent: ({ formId, setLoading }) => (
      <DatasetEditContent {...props} formId={formId} onLoadingChange={setLoading} />
    ),
    renderFooter: ({ formId, loading }) => <DatasetEditFooter formId={formId} loading={loading} />,
    title: t('dataset.edit.title', { ns: 'eval' }),
    width: 480,
  });
