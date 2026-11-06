'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { memo } from 'react';

/**
 * Shared with the dropdown-style widgets (locale / workspace role), whose
 * trigger has to be a plain element instead of a `<button>` with `onClick`.
 */
export const barButtonStyles = stylex.create({
  button: {
    cursor: 'pointer',
    display: 'inline-flex',
    flexShrink: 0,
    gap: '4px',
    alignItems: 'center',
    height: '20px',
    paddingInline: '4px',
    borderStyle: 'none',
    borderRadius: '4px',
    fontSize: '11px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
});

interface BarButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  title?: string;
}

const BarButton = memo<BarButtonProps>(({ icon: Icon, label, onClick, title }) => (
  <button {...stylex.props(barButtonStyles.button)} title={title} type={'button'} onClick={onClick}>
    <Icon size={11} />
    <span>{label}</span>
  </button>
));

BarButton.displayName = 'DevDockBarButton';

export default BarButton;
