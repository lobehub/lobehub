'use client';

import {
  Alert,
  Button,
  createStaticStyles,
  cssVar,
  cx,
  Flexbox,
  Icon,
  Popover,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { AlertTriangle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';

import type { ChatInputNotice } from './useChatInputNotice';

const styles = createStaticStyles(({ css }) => ({
  action: css`
    flex: none;
    height: 24px;
    padding-inline: 10px;
  `,
  actionWrapper: css`
    display: inline-flex;
  `,
  alert: css`
    gap: 6px !important;
    align-items: flex-start !important;

    min-width: 0;
    padding-inline: 8px 10px !important;
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSizeSM};

    .ant-alert-content {
      min-width: 0;
    }

    .ant-alert-icon {
      flex: none;
      height: 18px !important;
      margin-block-start: 1px;
      margin-inline-end: 0 !important;
    }
  `,
  list: css`
    overflow-y: auto;
    overscroll-behavior: contain;
    width: min(360px, calc(100vw - 32px));
    max-height: min(320px, calc(100vh - 96px));
  `,
  notice: css`
    width: 100%;
    padding-block: 6px !important;
  `,
  summary: css`
    min-width: 36px;
    height: 26px;
    padding-inline: 6px;

    && {
      color: ${cssVar.colorWarning};
      background: color-mix(in srgb, ${cssVar.colorWarning} 12%, ${cssVar.colorBgContainer});
    }

    &&:hover,
    &&:active,
    &&[data-popup-open] {
      color: ${cssVar.colorWarning};
      background: color-mix(in srgb, ${cssVar.colorWarning} 18%, ${cssVar.colorBgContainer});
    }
  `,
  title: css`
    min-width: 0;

    font-size: 12px;
    line-height: 18px !important;
    overflow-wrap: anywhere;
    white-space: normal;
  `,
}));

const popoverStyles = { content: { padding: 8 } } as const;

interface NoticeAlertProps {
  notice: ChatInputNotice;
}

const NoticeAlert = ({ notice }: NoticeAlertProps) => {
  const { t } = useTranslation('chat');

  const enableButton = notice.action === 'enableModel' && (
    <Button
      className={styles.action}
      disabled={notice.actionDisabled}
      loading={notice.actionLoading}
      size={'small'}
      type={'primary'}
      onClick={() => void notice.onAction?.()}
    >
      {t('input.modelDisabled.action')}
    </Button>
  );

  const action =
    enableButton && notice.actionDisabled ? (
      <Tooltip title={notice.actionDisabledReason}>
        <span className={styles.actionWrapper}>{enableButton}</span>
      </Tooltip>
    ) : (
      enableButton
    );

  return (
    <Alert
      action={action}
      title={t(notice.key)}
      type={notice.type}
      variant={'borderless'}
      classNames={{
        alert: cx(styles.alert, styles.notice),
        title: styles.title,
      }}
    />
  );
};

/**
 * Renders the chat-input notice presentation for a resolved notice collection.
 *
 * Use when:
 * - The caller already owns notice resolution
 * - A controlled preview needs to exercise the production presentation
 *
 * Expects:
 * - Notices ordered from the broadest blocker to narrower configuration issues
 *
 * Returns:
 * - Nothing for zero notices, or a compact summary that expands every resolved notice
 */
export const ChatInputNoticeContent = memo(({ notices }: { notices: ChatInputNotice[] }) => {
  const { t } = useTranslation('chat');
  const isMobile = useIsMobile();
  if (notices.length === 0) return null;

  const summary = t('input.notice.summary', { count: notices.length });

  return (
    <Popover
      arrow
      standalone
      closeDelay={160}
      openDelay={100}
      placement={'top'}
      styles={popoverStyles}
      trigger={isMobile ? 'click' : ['hover', 'click']}
      content={
        <Flexbox className={styles.list} gap={8}>
          <Text fontSize={12} type={'secondary'} weight={500}>
            {summary}
          </Text>
          {notices.map((notice) => (
            <NoticeAlert key={notice.key} notice={notice} />
          ))}
        </Flexbox>
      }
    >
      <Button
        aria-label={summary}
        className={styles.summary}
        icon={<Icon icon={AlertTriangle} size={14} />}
        size={'small'}
        type={'text'}
      >
        {notices.length}
      </Button>
    </Popover>
  );
});

ChatInputNoticeContent.displayName = 'ChatInputNoticeContent';
