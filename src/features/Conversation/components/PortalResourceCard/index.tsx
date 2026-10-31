'use client';

import { Center, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileText } from 'lucide-react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const FOCUS_RING = {
  outlineWidth: { 'default': null, ':focus-visible': '2px' },
  outlineStyle: { 'default': null, ':focus-visible': 'solid' },
  outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
  outlineOffset: { 'default': null, ':focus-visible': '2px' },
} as const;

const styles = stylex.create({
  actionable: {
    cursor: 'pointer',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    ...FOCUS_RING,
  },
  avatar: {
    flex: 'none',
    alignSelf: 'stretch',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  openLabel: {
    display: 'flex',
    alignItems: 'center',
    height: '28px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '6px',
    fontSize: '13px',
    lineHeight: 1,
    color: cssVar.colorText,
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  actionButton: {
    cursor: 'pointer',
    height: '28px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '6px',
    fontSize: '13px',
    lineHeight: 1,
    color: cssVar.colorText,
    whiteSpace: 'nowrap',
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    ...FOCUS_RING,
  },
  container: {
    overflow: 'hidden',
    width: '100%',
    height: '64px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  content: { overflow: 'hidden', minWidth: 0 },
  desc: { fontSize: '12px', lineHeight: 1.3, color: cssVar.colorTextTertiary },
  title: { fontWeight: 500, lineHeight: 1.35 },
  trigger: { overflow: 'hidden', minWidth: 0, height: '100%' },
});

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
      <Flexbox horizontal align={'center'} {...sx([styles.container], className)}>
        <Flexbox
          horizontal
          align={'center'}
          {...stylex.props(styles.trigger, onOpen && styles.actionable)}
          flex={1}
          role={onOpen ? 'button' : undefined}
          tabIndex={onOpen ? 0 : undefined}
          onClick={onOpen}
          onKeyDown={onOpen ? handleKeyDown : undefined}
        >
          <Center horizontal {...stylex.props(styles.avatar)} width={64}>
            {icon ?? <Icon icon={FileText} size={28} />}
          </Center>
          <Flexbox {...stylex.props(styles.content)} flex={1} gap={4} paddingInline={12}>
            <Text ellipsis {...stylex.props(styles.title)}>
              {title}
            </Text>
            {description && (
              <Text ellipsis {...stylex.props(styles.desc)}>
                {description}
              </Text>
            )}
          </Flexbox>
          {onOpen && openLabel && (
            <Flexbox flex={'none'} style={{ paddingInlineEnd: 10 }}>
              <div aria-hidden {...stylex.props(styles.openLabel)}>
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
                    {...stylex.props(styles.actionButton)}
                    type={'button'}
                    onClick={handleSecondaryActionClick}
                  >
                    {secondaryActionLabel}
                  </button>
                ) : (
                  <div aria-hidden {...stylex.props(styles.openLabel)}>
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
