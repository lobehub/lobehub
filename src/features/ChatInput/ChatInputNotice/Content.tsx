'use client';

import { Alert, Button, Flexbox, Icon, Popover, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AlertTriangle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';

import type { ChatInputNotice } from './useChatInputNotice';

// The `!important`s of the emotion version are gone: lobe-ui's Alert and Button styles
// live in a CSS layer, so these unlayered StyleX rules win without them.
const summaryWarning = `color-mix(in srgb, ${cssVar.colorWarning} 12%, ${cssVar.colorBgContainer})`;
const summaryWarningActive = `color-mix(in srgb, ${cssVar.colorWarning} 18%, ${cssVar.colorBgContainer})`;

const styles = stylex.create({
  action: { flex: 'none', height: '24px', paddingInline: '10px' },
  actionWrapper: { display: 'inline-flex' },
  alert: {
    gap: '6px',
    alignItems: 'flex-start',
    minWidth: '0',
    paddingInlineStart: '8px',
    paddingInlineEnd: '10px',
    borderRadius: cssVar.borderRadius,
    fontSize: cssVar.fontSizeSM,
  },
  list: {
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    width: 'min(360px, calc(100vw - 32px))',
    maxHeight: 'min(320px, calc(100vh - 96px))',
  },
  notice: { width: '100%', paddingBlock: '6px' },
  summary: {
    minWidth: '36px',
    height: '26px',
    paddingInline: '6px',
    color: cssVar.colorWarning,
    backgroundColor: {
      'default': summaryWarning,
      ':hover': summaryWarningActive,
      ':active': summaryWarningActive,
      ':is([data-popup-open])': summaryWarningActive,
    },
    backgroundImage: 'none',
  },
  title: {
    minWidth: '0',
    fontSize: '12px',
    lineHeight: '18px',
    overflowWrap: 'anywhere',
    whiteSpace: 'normal',
  },
});

const popoverStyles = { content: { padding: 8 } } as const;

interface NoticeAlertProps {
  notice: ChatInputNotice;
}

const NoticeAlert = ({ notice }: NoticeAlertProps) => {
  const { t } = useTranslation('chat');

  const enableButton = notice.action === 'enableModel' && (
    <Button
      className={stylex.props(styles.action).className}
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
        <span {...stylex.props(styles.actionWrapper)}>{enableButton}</span>
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
        alert: stylex.props(styles.alert, styles.notice).className,
        title: stylex.props(styles.title).className,
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
        <Flexbox className={stylex.props(styles.list).className} gap={8}>
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
        className={stylex.props(styles.summary).className}
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
