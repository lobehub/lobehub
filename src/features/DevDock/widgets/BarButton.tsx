'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { memo } from 'react';

/**
 * Shared with the dropdown-style widgets (locale / workspace role), whose
 * trigger has to be a plain element instead of a `<button>` with `onClick`.
 */
export const barButtonStyles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: inline-flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    height: 20px;
    padding-inline: 4px;
    border: none;
    border-radius: 4px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

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
  title?: string;
}

const BarButton = memo<BarButtonProps>(({ icon: Icon, label, onClick, title }) => (
  <button className={barButtonStyles.button} title={title} type={'button'} onClick={onClick}>
    <Icon size={11} />
    <span>{label}</span>
  </button>
));

BarButton.displayName = 'DevDockBarButton';

export default BarButton;
