'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { useGlobalStore } from '@/store/global';

import FeedbackContent from './FeedbackContent';
import type { FeedbackInitialValues } from './types';

export type { FeedbackInitialValues } from './types';

interface OpenFeedbackModalOptions {
  initialValues?: FeedbackInitialValues;
}

export const openFeedbackModal = ({ initialValues }: OpenFeedbackModalOptions = {}) => {
  // Close command menu when opening feedback modal
  useGlobalStore.getState().updateSystemStatus({ showCommandMenu: false });

  return createModal({
    content: <FeedbackContent initialValues={initialValues} />,
    footer: null,
    maskClosable: true,
    title: t('feedback.title', { ns: 'common' }),
    width: 600,
  });
};

export default openFeedbackModal;
