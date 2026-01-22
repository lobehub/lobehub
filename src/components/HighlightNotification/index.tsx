'use client';

import { HeartFilled } from '@ant-design/icons';
import { ActionIcon, Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { X } from 'lucide-react';
import { type ReactNode, memo } from 'react';

export interface HighlightNotificationProps {
  description?: ReactNode;
  image?: string;
  onClose?: () => void;
  open?: boolean;
  title?: ReactNode;
}

const styles = createStaticStyles(({ css }) => ({
  action: css`
    margin-top: 8px;
  `,
  card: css`
    position: fixed;
    bottom: 56px;
    left: 8px;
    z-index: 1000;

    width: 300px;
    max-width: calc(100vw - 32px);
    padding: 0px;

    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);

    overflow: hidden;
  `,
  closeButton: css`
    position: absolute;
    top: 8px;
    right: 8px;
  `,
  description: css`
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  image: css`
    width: 100%;
    height: auto;

    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

const HighlightNotification = memo<HighlightNotificationProps>(
  ({ open, onClose, image, title, description }) => {
    if (!open) return null;

    return (
      <Flexbox className={styles.card}>
        <ActionIcon className={styles.closeButton} icon={X} onClick={onClose} size={14} />
        <Flexbox gap={0}>
          {image && <img alt="" className={styles.image} src={image} />}
          <Flexbox gap={4} padding={12}>
            {title && <div className={styles.title}>{title}</div>}
            {description && <div className={styles.description}>{description}</div>}
            <Button className={styles.action} icon={HeartFilled} size="small" type="primary">
              Support us
            </Button>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

HighlightNotification.displayName = 'HighlightNotification';

export default HighlightNotification;
