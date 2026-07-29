'use client';

import { Alert } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputNotice } from './useChatInputNotice';

const styles = createStaticStyles(({ css, cssVar }) => ({
  alert: css`
    flex: 0 1 auto;

    /* The Alert root already flex-gaps icon and content; without zeroing the
       icon margin below the two would stack into a ~14px gap. */
    gap: 6px !important;

    /* Keep the icon centered against the single-line title. */
    align-items: center !important;

    min-width: 0;
    max-width: min(560px, 52vw);
    padding-block: 4px !important;
    padding-inline: 8px 10px !important;
    border-radius: ${cssVar.borderRadius};

    .ant-alert-content {
      min-width: 0;
    }

    .ant-alert-message,
    .ant-alert-title {
      overflow: hidden;

      font-size: 12px;
      line-height: 18px !important;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ant-alert-icon {
      flex: none;
      height: 18px !important;
      margin-inline-end: 0 !important;
    }

    @media (width <= 768px) {
      max-width: 100%;
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
