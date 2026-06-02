'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import TestCaseCreateContent, { type TestCaseCreateContentProps } from './Content';

export const createTestCaseCreateModal = (props: TestCaseCreateContentProps): ModalInstance =>
  createModal({
    content: <TestCaseCreateContent {...props} />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title: t('testCase.create.title', { ns: 'eval' }),
    width: 520,
  });
