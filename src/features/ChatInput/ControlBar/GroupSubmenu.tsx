'use client';

import { Flexbox, Popover } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import OptionRow from './OptionRow';
import SubmenuHeader from './SubmenuHeader';

const styles = stylex.create({
  list: {
    overflowY: 'auto',
    maxHeight: '360px',
  },
});

/**
 * The list can grow after the submenu opens (a reconnect, a fresh device list),
 * so the positioner is left to size itself again rather than keep its first
 * measurement — same as the work-location submenus.
 */
const SUBMENU_STYLES = {
  content: { padding: 4 },
  root: { height: 'auto', width: 'auto' },
};

interface GroupSubmenuProps {
  /** One of the group's choices is the current one. */
  active?: boolean;
  /** The submenu's rows. */
  children: ReactNode;
  /** A status line under the label, such as how many machines are online. */
  desc?: ReactNode;
  /** The current pick by name, beside the label. */
  hint?: ReactNode;
  icon: ReactNode;
  label: string;
  testId?: string;
}

/**
 * One group in the execution environment menu, as a second level: the first
 * level keeps a single row per group, and the group's choices open beside it.
 * Hover opens it with a pointer and a click opens it on touch, so the second
 * level never depends on hover alone.
 */
const GroupSubmenu = memo<GroupSubmenuProps>(
  ({ active, children, desc, hint, icon, label, testId }) => (
    <Popover
      arrow={false}
      closeDelay={150}
      placement={'rightBottom'}
      styles={SUBMENU_STYLES}
      trigger={['hover', 'click']}
      content={
        <Flexbox gap={2} style={{ maxWidth: 280, minWidth: 240 }}>
          <SubmenuHeader title={label} />
          <div {...stylex.props(styles.list)}>{children}</div>
        </Flexbox>
      }
    >
      <div data-testid={testId}>
        <OptionRow
          arrow
          compact
          active={active}
          desc={desc}
          hint={hint}
          icon={icon}
          label={label}
          onClick={() => {}}
        />
      </div>
    </Popover>
  ),
);

GroupSubmenu.displayName = 'GroupSubmenu';

export default GroupSubmenu;
