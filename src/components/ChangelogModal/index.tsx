'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import ChangelogModalContent from './ChangelogModalContent';

export const openChangelogModal = () =>
  createModal({
    content: <ChangelogModalContent />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 0 },
    },
    title: t('changelog', { ns: 'common' }),
    width: 800,
  });

export default openChangelogModal;
