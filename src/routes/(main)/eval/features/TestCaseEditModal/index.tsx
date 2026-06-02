'use client';

import { type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { createFormModal } from '@/utils/createFormModal';

import TestCaseEditContent, { type TestCaseEditContentProps } from './Content';
import TestCaseEditFooter from './Footer';

type Props = Omit<TestCaseEditContentProps, 'formId' | 'onLoadingChange'>;

export const createTestCaseEditModal = (props: Props): ModalInstance =>
  createFormModal({
    renderContent: ({ formId, setLoading }) => (
      <TestCaseEditContent {...props} formId={formId} onLoadingChange={setLoading} />
    ),
    renderFooter: ({ formId, loading }) => <TestCaseEditFooter formId={formId} loading={loading} />,
    title: t('testCase.edit.title', { ns: 'eval' }),
    width: 520,
  });
