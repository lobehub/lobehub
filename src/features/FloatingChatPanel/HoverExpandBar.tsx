'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronUp } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  bar: css`
    pointer-events: auto;

    position: absolute;
    inset-block-end: 100%;
    inset-inline: 0;
    transform: translateY(4px);

    display: flex;
    align-items: center;
    justify-content: center;

    height: 28px;
    padding-block-end: 4px;

    opacity: 0;
    background: transparent;

    transition:
      opacity 160ms ease-out,
      transform 160ms ease-out;
  `,
  visible: css`
    transform: translateY(0);
    opacity: 1;
  `,
  trigger: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    height: 24px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};

    transition:
      color 160ms,
      border-color 160ms,
      background 160ms;

    &:hover {
      border-color: ${cssVar.colorBorder};
      color: ${cssVar.colorText};
      background: ${cssVar.colorBgContainer};
    }
  `,
  hidden: css`
    pointer-events: none;
  `,
}));

export interface HoverExpandBarProps {
  onExpand: () => void;
  visible: boolean;
}

const HoverExpandBar = memo<HoverExpandBarProps>(({ visible, onExpand }) => {
  const { t } = useTranslation('chat');
  const s = styles;

  return (
    <div
      aria-hidden={!visible}
      className={`${s.bar} ${visible ? s.visible : s.hidden}`}
      data-testid="floating-chat-panel-hover-bar"
    >
      <button
        className={s.trigger}
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
