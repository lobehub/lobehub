'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    height: 20px;
    padding-inline: 6px;
    border: none;
    border-radius: 4px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface BarButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

const BarButton = memo<BarButtonProps>(({ icon: Icon, label, onClick }) => (
  <button className={styles.button} type={'button'} onClick={onClick}>
    <Icon size={11} />
    <span>{label}</span>
  </button>
));

BarButton.displayName = 'DevDockBarButton';

export default BarButton;
