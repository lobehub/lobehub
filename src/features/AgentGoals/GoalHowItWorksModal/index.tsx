'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import HowItWorksContent from './HowItWorksContent';

export const createGoalHowItWorksModal = (): ModalInstance =>
  createModal({
    content: <HowItWorksContent />,
    footer: null,
    maskClosable: true,
    title: t('goalEmpty.howTitle', { ns: 'chat' }),
    width: 'min(88vw, 520px)',
  });
