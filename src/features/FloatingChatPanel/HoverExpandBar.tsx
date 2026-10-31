'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronUp } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  bar: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    display: 'flex',
    height: '28px',
    insetBlockEnd: '100%',
    insetInline: 0,
    justifyContent: 'center',
    opacity: 0,
    paddingBlockEnd: '4px',
    pointerEvents: 'auto',
    position: 'absolute',
    transform: 'translateY(4px)',
    transition: 'opacity 160ms ease-out, transform 160ms ease-out',
  },
  hidden: {
    pointerEvents: 'none',
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: { 'default': cssVar.colorBgElevated, ':hover': cssVar.colorBgContainer },
    backgroundImage: 'none',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: '12px',
    borderStyle: 'solid',
    borderWidth: '1px',
    boxShadow: cssVar.boxShadowTertiary,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: '12px',
    gap: '6px',
    height: '24px',
    lineHeight: 1,
    paddingInline: '10px',
    transition: 'color 160ms, border-color 160ms, background 160ms',
  },
  visible: {
    opacity: 1,
    transform: 'translateY(0)',
  },
});

export interface HoverExpandBarProps {
  bottomOffset?: number;
  onExpand: () => void;
  visible: boolean;
}

const HoverExpandBar = memo<HoverExpandBarProps>(({ bottomOffset = 0, visible, onExpand }) => {
  const { t } = useTranslation('chat');

  return (
    <div
      aria-hidden={!visible}
      {...sx(
        [styles.bar, visible ? styles.visible : styles.hidden],
        undefined,
        bottomOffset > 0 ? { insetBlockEnd: `calc(100% + ${bottomOffset}px)` } : undefined,
      )}
      data-testid="floating-chat-panel-hover-bar"
    >
      <button
        {...stylex.props(styles.trigger)}
        data-testid="floating-chat-panel-expand-button"
        tabIndex={visible ? 0 : -1}
        type="button"
        onClick={onExpand}
      >
        <Icon icon={ChevronUp} size={12} />
        {t('floatingChatPanel.expand', { defaultValue: 'Expand' })}
      </button>
    </div>
  );
});

HoverExpandBar.displayName = 'FloatingChatPanelHoverExpandBar';

export default HoverExpandBar;
