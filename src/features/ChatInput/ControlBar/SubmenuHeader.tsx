'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  action: {
    cursor: 'pointer',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    padding: '0',
    borderStyle: 'none',
    fontSize: '11px',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorPrimary },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: 'color 0.2s',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '4px',
    paddingInline: '8px',
  },
  title: {
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
});

interface SubmenuHeaderProps {
  /** A quiet link on the right that leaves the menu for the place this list is managed. */
  action?: { icon: LucideIcon; label: string; onClick: () => void };
  title: string;
}

/** The title row of a work-location submenu. */
const SubmenuHeader = memo<SubmenuHeaderProps>(({ action, title }) => (
  <div {...stylex.props(styles.header)}>
    <span {...stylex.props(styles.title)}>{title}</span>
    {action && (
      <button {...stylex.props(styles.action)} type={'button'} onClick={action.onClick}>
        <Icon icon={action.icon} size={11} />
        <span>{action.label}</span>
      </button>
    )}
  </div>
));

SubmenuHeader.displayName = 'SubmenuHeader';

export default SubmenuHeader;
