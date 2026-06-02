'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import TestCasePreviewContent, { type TestCasePreviewContentProps } from './Content';

export const createTestCasePreviewModal = (props: TestCasePreviewContentProps): ModalInstance =>
  createModal({
    content: <TestCasePreviewContent {...props} />,
    footer: null,
    styles: {
      content: { padding: 0 },
    },
    title: t('testCase.preview.title', { ns: 'eval' }),
    width: 600,
  });
