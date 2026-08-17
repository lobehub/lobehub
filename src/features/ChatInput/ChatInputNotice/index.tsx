'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { Alert, type AlertType } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputNotice } from './useChatInputNotice';

// Mirrors `@lobehub/ui` Alert's own per-type icon fallback, so the narrow-screen
// compact icon never disagrees with the icon the full Alert would have shown
// for the same notice.
const typeIcons: Record<AlertType, typeof AlertTriangle> = {
  error: XCircle,
  info: Info,
  secondary: AlertTriangle,
  success: CheckCircle,
  warning: AlertTriangle,
};

// Mirrors the accent color each Alert tone applies via `--lobe-alert-accent`, so
// the compact icon still reads with the right semantic color once it's on its
// own, outside the Alert that would normally set that CSS variable.
const typeColor: Record<AlertType, string> = {
  error: cssVar.colorError,
  info: cssVar.colorInfo,
  secondary: cssVar.colorTextSecondary,
  success: cssVar.colorSuccess,
  warning: cssVar.colorWarning,
};

// Below this the leftSlot no longer has room for icon + single-line title
// without wrapping — collapse to an icon-only trigger and move the message
// into a tooltip instead of fighting for space inline.
const COMPACT_BREAKPOINT = 200;

const styles = createStaticStyles(({ css, cssVar }) => ({
  alertContent: css`
    min-width: 0;
  `,
  alertIcon: css`
    flex: none;
    height: 18px !important;
    margin-inline-end: 0 !important;
  `,
  alertRoot: css`
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

    @container chat-input-notice (width < ${COMPACT_BREAKPOINT}px) {
      display: none;
    }

    @media (width <= 768px) {
      max-width: 100%;
    }
  `,
  alertTitle: css`
    overflow: hidden;

    font-size: 12px;
    line-height: 18px !important;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  compactTrigger: css`
    display: none;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 22px;
    height: 18px;
    border-radius: ${cssVar.borderRadius};

    cursor: default;

    @container chat-input-notice (width < ${COMPACT_BREAKPOINT}px) {
      display: inline-flex;
    }
  `,
  container: css`
    container: chat-input-notice / inline-size;

    display: flex;
    flex: 0 1 auto;
    align-items: center;
    min-width: 0;
  `,
}));

const ChatInputNotice = memo(() => {
  const { t } = useTranslation('chat');
  const notice = useChatInputNotice();

  if (!notice) return null;

  const message = t(notice.key);
  const NoticeIcon = typeIcons[notice.type];

  return (
    <div className={styles.container}>
      <Alert
        classNames={{
          content: styles.alertContent,
          icon: styles.alertIcon,
          root: cx(styles.alertRoot),
          title: styles.alertTitle,
        }}
        style={{ fontSize: 12 }}
        title={message}
        type={notice.type}
        variant={'borderless'}
      />
      <Tooltip title={message}>
        <span className={styles.compactTrigger} style={{ color: typeColor[notice.type] }}>
          <Icon icon={NoticeIcon} size={14} />
        </span>
      </Tooltip>
    </div>
  );
});

ChatInputNotice.displayName = 'ChatInputNotice';

export default ChatInputNotice;
