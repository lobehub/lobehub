'use client';

import { Alert } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputNotice } from './useChatInputNotice';

const styles = createStaticStyles(({ css }) => ({
  alert: css`
    /* Keep the icon centered against the single-line title. */
    align-items: center !important;

    .ant-alert-title {
      font-size: 12px;
      line-height: 18px !important;
    }

    .ant-alert-icon {
      height: 18px !important;
    }
  `,
}));

const ChatInputNotice = memo(() => {
  const { t } = useTranslation('chat');
  const notice = useChatInputNotice();

  if (!notice) return null;

  return (
    <Alert
      classNames={{ alert: cx(styles.alert) }}
      style={{ fontSize: 12 }}
      title={t(notice.key)}
      type={notice.type}
      variant={'borderless'}
    />
  );
});

ChatInputNotice.displayName = 'ChatInputNotice';

export default ChatInputNotice;
