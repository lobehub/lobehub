'use client';

import { Center, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { FileText } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  avatar: css`
    flex: none;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorFillQuaternary};
  `,
  openLabel: css`
    display: flex;
    align-items: center;

    height: 28px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 6px;

    font-size: 13px;
    line-height: 1;
    color: ${cssVar.colorText};
    white-space: nowrap;

    background: ${cssVar.colorBgContainer};
  `,
  container: css`
    width: 100%;
    min-height: 48px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    overflow: hidden;
    min-width: 0;
  `,
  desc: css`
    font-size: 12px;
    line-height: 1.3;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    font-weight: 500;
    line-height: 1.35;
  `,
}));

export interface PortalResourceCardProps {
  className?: string;
  description?: ReactNode;
  icon?: LucideIcon;
  onOpen?: () => void;
  openLabel?: ReactNode;
  title: ReactNode;
  tooltip?: ReactNode;
}

const PortalResourceCard = memo<PortalResourceCardProps>(
  ({ className, description, icon = FileText, openLabel, title, tooltip, onOpen }) => {
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (!onOpen) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;

      event.preventDefault();
      onOpen();
    };

    // Mirrors the inline artifact card shell, while keeping portal-open behavior owned by callers.
    const card = (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.container, onOpen && styles.actionable, className)}
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen}
        onKeyDown={onOpen ? handleKeyDown : undefined}
      >
        <Center horizontal className={styles.avatar} height={48} width={48}>
          <Icon icon={icon} size={22} />
        </Center>
        <Flexbox className={styles.content} flex={1} gap={2} paddingBlock={6} paddingInline={10}>
          <Text ellipsis className={styles.title}>
            {title}
          </Text>
          {description && (
            <Text ellipsis className={styles.desc}>
              {description}
            </Text>
          )}
        </Flexbox>
        {onOpen && openLabel && (
          <Flexbox flex={'none'} style={{ paddingInlineEnd: 10 }}>
            <div aria-hidden className={styles.openLabel}>
              {openLabel}
            </div>
          </Flexbox>
        )}
      </Flexbox>
    );

    return tooltip ? (
      <Tooltip placement={'topLeft'} title={tooltip}>
        {card}
      </Tooltip>
    ) : (
      card
    );
  },
);

PortalResourceCard.displayName = 'PortalResourceCard';

export default PortalResourceCard;
