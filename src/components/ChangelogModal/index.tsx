'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { ArrowUpRightIcon } from 'lucide-react';

import { CHANGELOG_URL } from '@/const/url';

import ChangelogModalContent from './ChangelogModalContent';

export const openChangelogModal = () =>
  createModal({
    content: <ChangelogModalContent />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 0 },
    },
    title: (
      <a
        href={CHANGELOG_URL}
        rel="noopener noreferrer"
        target="_blank"
        style={{
          alignItems: 'center',
          color: 'inherit',
          display: 'inline-flex',
          gap: 6,
          textDecoration: 'none',
        }}
      >
        {t('changelog', { ns: 'common' })}
        <ArrowUpRightIcon size={16} />
      </a>
    ),
    width: 800,
  });

export default openChangelogModal;
