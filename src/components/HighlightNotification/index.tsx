'use client';

import { HeartFilled } from '@ant-design/icons';
import { ActionIcon, Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { X } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode } from 'react';
import { memo } from 'react';

export interface HighlightNotificationProps {
  actionHref?: string;
  actionLabel?: ReactNode;
  description?: ReactNode;
  image?: string;
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
  ({ open, onClose, onActionClick, image, title, description, actionLabel, actionHref }) => {
    if (!open) return null;

    return (
      <Flexbox className={styles.card}>
        <ActionIcon className={styles.closeButton} icon={X} size={14} onClick={onClose} />
        <Flexbox gap={0}>
          {image && <img alt="" className={styles.image} src={image} />}
          <Flexbox gap={4} padding={12}>
            {title && <div className={styles.title}>{title}</div>}
            {description && <div className={styles.description}>{description}</div>}
            {actionLabel && (
              <Link
                className={styles.action}
                href={actionHref || '/'}
                rel="noopener noreferrer"
                target="_blank"
                onClick={onActionClick}
              >
                <Button block icon={HeartFilled} size="small" type="primary">
                  {actionLabel}
                </Button>
              </Link>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

HighlightNotification.displayName = 'HighlightNotification';

export default HighlightNotification;
