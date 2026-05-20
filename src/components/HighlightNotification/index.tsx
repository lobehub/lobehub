'use client';

import { HeartFilled } from '@ant-design/icons';
import { ActionIcon, Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { X } from 'lucide-react';
import type { HTMLAttributeAnchorTarget, ReactNode } from 'react';
import { memo } from 'react';

export interface HighlightNotificationProps {
  actionHref?: string;
  actionIcon?: ReactNode;
  actionLabel?: ReactNode;
  actionTarget?: HTMLAttributeAnchorTarget;
  description?: ReactNode;
  image?: string;
  onAction?: () => void;
  onActionClick?: () => void;
  onClose?: () => void;
  open?: boolean;
  title?: ReactNode;
}

const styles = createStaticStyles(({ css }) => ({
  action: css`
    display: block;
    width: 100%;
    margin-block-start: 8px;
  `,
  actionContent: css`
    display: inline-flex;
    gap: 8px;
    align-items: center;
    justify-content: center;

    width: 100%;
  `,
  card: css`
    position: fixed;
    z-index: 1000;
    inset-block-end: 56px;
    inset-inline-start: 8px;

    overflow: hidden;

    width: 300px;
    max-width: calc(100vw - 32px);
    padding: 0;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 4px 24px rgb(0 0 0 / 12%);
  `,
  closeButton: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 8px;
  `,
  description: css`
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  image: css`
    width: 100%;
    height: auto;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

const HighlightNotification = memo<HighlightNotificationProps>(
  ({
    actionHref,
    actionIcon = <HeartFilled />,
    actionLabel,
    actionTarget = '_blank',
    description,
    image,
    onAction,
    onActionClick,
    onClose,
    open,
    title,
  }) => {
    if (!open) return null;

    const actionContent = actionLabel ? (
      <span className={styles.actionContent}>
        {actionIcon && <span>{actionIcon}</span>}
        <span>{actionLabel}</span>
      </span>
    ) : null;

    return (
      <Flexbox className={styles.card}>
        <ActionIcon className={styles.closeButton} icon={X} size={14} onClick={onClose} />
        <Flexbox gap={0}>
          {image && <img alt="" className={styles.image} src={image} />}
          <Flexbox gap={4} padding={12}>
            {title && <div className={styles.title}>{title}</div>}
            {description && <div className={styles.description}>{description}</div>}
            {actionLabel && actionHref && (
              <a
                className={styles.action}
                href={actionHref}
                rel="noopener noreferrer"
                target={actionTarget}
                onClick={onActionClick}
              >
                <Button block size="small" type="primary">
                  {actionContent}
                </Button>
              </a>
            )}
            {actionLabel && !actionHref && (
              <Button
                block
                className={styles.action}
                size="small"
                type="primary"
                onClick={onAction}
              >
                {actionContent}
              </Button>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

HighlightNotification.displayName = 'HighlightNotification';

export default HighlightNotification;
