'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import TestCaseEditContent, { type TestCaseEditContentProps } from './Content';

export const createTestCaseEditModal = (props: TestCaseEditContentProps): ModalInstance =>
  createModal({
    content: <TestCaseEditContent {...props} />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title: t('testCase.edit.title', { ns: 'eval' }),
    width: 520,
  });
