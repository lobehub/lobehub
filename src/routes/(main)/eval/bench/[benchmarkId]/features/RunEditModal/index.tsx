'use client';

import { type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { createFormModal } from '@/utils/createFormModal';

import RunEditContent, { type RunEditContentProps } from './Content';
import RunEditFooter from './Footer';

type Props = Omit<RunEditContentProps, 'formId' | 'onLoadingChange'>;

export const createRunEditModal = (props: Props): ModalInstance =>
  createFormModal({
    renderContent: ({ formId, setLoading }) => (
      <RunEditContent {...props} formId={formId} onLoadingChange={setLoading} />
    ),
    renderFooter: ({ formId, loading }) => <RunEditFooter formId={formId} loading={loading} />,
    title: t('run.edit.title', { ns: 'eval' }),
    width: 520,
  });
