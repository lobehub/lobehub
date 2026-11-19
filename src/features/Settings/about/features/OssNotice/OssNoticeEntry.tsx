'use client';

import { createModal } from '@lobehub/ui';
import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import OssNoticeContent from './OssNoticeContent';

// Reset the button to the look of the About page's text links (ItemLink).
const triggerStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  padding: 0,
};

/**
 * Opens the notice from a plain button so it reads like the other About links and
 * stays keyboard reachable.
 */
const OssNoticeEntry = () => {
  const { t } = useTranslation('common');

  return (
    <button
      style={triggerStyle}
      type={'button'}
      onClick={() =>
        createModal({
          content: <OssNoticeContent />,
          footer: null,
          maskClosable: true,
          styles: { content: { paddingBlock: 16, paddingInline: 24 } },
          title: t('openSourceNotice.title'),
          width: 'min(90vw, 640px)',
        })
      }
    >
      {t('openSourceNotice.title')}
    </button>
  );
};

export default OssNoticeEntry;
