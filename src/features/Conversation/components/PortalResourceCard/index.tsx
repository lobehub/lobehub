'use client';

import { Center, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { FileText } from 'lucide-react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
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
    align-self: stretch;
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
  actionButton: css`
    cursor: pointer;

    height: 28px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 6px;

    font-size: 13px;
    line-height: 1;
    color: ${cssVar.colorText};
    white-space: nowrap;

    background: ${cssVar.colorBgContainer};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  container: css`
    overflow: hidden;

    width: 100%;
    height: 64px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

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
  trigger: css`
    overflow: hidden;
    min-width: 0;
    height: 100%;
  `,
}));

export interface PortalResourceCardProps {
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  onOpen?: () => void;
  onSecondaryAction?: () => void;
  openLabel?: ReactNode;
  secondaryAction?: ReactNode;
  secondaryActionLabel?: ReactNode;
  title: ReactNode;
  tooltip?: ReactNode;
}

const PortalResourceCard = memo<PortalResourceCardProps>(
  ({
    className,
    description,
    icon,
    openLabel,
    secondaryAction,
    secondaryActionLabel,
    title,
    tooltip,
    onOpen,
    onSecondaryAction,
  }) => {
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (!onOpen) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;

      event.preventDefault();
      onOpen();
    };
    const handleSecondaryActionClick = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onSecondaryAction?.();
    };

    // Mirrors the inline artifact card shell, while keeping portal-open behavior owned by callers.
    const card = (
      <Flexbox horizontal align={'center'} className={cx(styles.container, className)}>
        <Flexbox
          horizontal
          align={'center'}
          className={cx(styles.trigger, onOpen && styles.actionable)}
          flex={1}
          role={onOpen ? 'button' : undefined}
          tabIndex={onOpen ? 0 : undefined}
          onClick={onOpen}
          onKeyDown={onOpen ? handleKeyDown : undefined}
        >
          <Center horizontal className={styles.avatar} width={64}>
            {icon ?? <Icon icon={FileText} size={28} />}
          </Center>
          <Flexbox className={styles.content} flex={1} gap={4} paddingInline={12}>
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
        {(secondaryAction || secondaryActionLabel) && (
          <Flexbox flex={'none'} style={{ paddingInlineEnd: 10 }}>
            {secondaryAction ?? (
              <>
                {onSecondaryAction ? (
                  <button
                    className={styles.actionButton}
                    type={'button'}
                    onClick={handleSecondaryActionClick}
                  >
                    {secondaryActionLabel}
                  </button>
                ) : (
                  <div aria-hidden className={styles.openLabel}>
                    {secondaryActionLabel}
                  </div>
                )}
              </>
            )}
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
