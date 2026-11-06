'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

const styles = stylex.create({
  icon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '50%',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  line: {
    flex: '1',
    width: '1px',
    marginBlock: '4px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
});

interface PanelSectionProps {
  children: ReactNode;
  desc?: ReactNode;
  icon: LucideIcon;
  /** Drops the connector below this section, which would otherwise dangle. */
  last?: boolean;
  /** Sits under the description, for something true of this section only. */
  notice?: ReactNode;
  title: ReactNode;
}

/**
 * One titled part of the detail panel, on a rail of its own.
 *
 * The panel used to be a single column of eight fields with nothing between
 * them, so finding the setup command meant reading every label on the way. The
 * rail gives each part a heading you can skip to and an icon to recognise it
 * by, without the nested cards that grouping usually costs — this panel is
 * already a card, and boxes inside boxes were how it got crowded before.
 *
 * Railway's settings page is the reference. Its right-hand jump list is not,
 * because this panel is half a page wide and that nav would take the half that
 * holds the fields.
 */
const PanelSection = memo<PanelSectionProps>(({ children, desc, icon, last, notice, title }) => (
  <Flexbox horizontal align={'stretch'} gap={12}>
    <Flexbox align={'center'} style={{ flex: 'none' }}>
      <span {...stylex.props(styles.icon)}>
        <Icon icon={icon} size={15} />
      </span>
      {!last && <div {...stylex.props(styles.line)} />}
    </Flexbox>

    <Flexbox flex={1} gap={12} paddingBlock={'4px 24px'} style={{ minWidth: 0 }}>
      <Text weight={600}>{title}</Text>
      {(desc || notice) && (
        <Flexbox gap={4}>
          {desc && (
            <Text fontSize={12} type={'secondary'}>
              {desc}
            </Text>
          )}
          {notice}
        </Flexbox>
      )}
      <Flexbox gap={16}>{children}</Flexbox>
    </Flexbox>
  </Flexbox>
));

PanelSection.displayName = 'PanelSection';

export default PanelSection;
