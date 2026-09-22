'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  icon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 50%;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  /**
   * The connector, as its own element in the icon's column rather than a border
   * on the content beside it. A border there began below the icon row and ended
   * with the content, so every heading left a gap the width of its own icon and
   * the rail arrived in pieces. Stretched to fill what the content leaves over,
   * it meets the next section's icon exactly.
   */
  line: css`
    flex: 1;
    width: 1px;
    margin-block: 4px;
    background: ${cssVar.colorBorderSecondary};
  `,
}));

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
      <span className={styles.icon}>
        <Icon icon={icon} size={15} />
      </span>
      {!last && <div className={styles.line} />}
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
