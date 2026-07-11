'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import SupplementForm from './SupplementForm';

export const createSupplementModal = () =>
  createModal({
    content: <SupplementForm />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: t('flow.steps.profile.supplementModal.title', { ns: 'onboarding' }),
    width: 'min(90%, 480px)',
  });
