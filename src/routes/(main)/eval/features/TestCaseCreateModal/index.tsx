'use client';

import { type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { createFormModal } from '@/utils/createFormModal';

import TestCaseCreateContent, { type TestCaseCreateContentProps } from './Content';
import TestCaseCreateFooter from './Footer';

type Props = Omit<TestCaseCreateContentProps, 'formId' | 'onLoadingChange'>;

export const createTestCaseCreateModal = (props: Props): ModalInstance =>
  createFormModal({
    renderContent: ({ formId, setLoading }) => (
      <TestCaseCreateContent {...props} formId={formId} onLoadingChange={setLoading} />
    ),
    renderFooter: ({ formId, loading }) => (
      <TestCaseCreateFooter formId={formId} loading={loading} />
    ),
    title: t('testCase.create.title', { ns: 'eval' }),
    width: 520,
  });
