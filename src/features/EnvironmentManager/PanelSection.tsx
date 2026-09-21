'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  /**
   * The rail the icons sit on. Drawn as a border on the body rather than an
   * element of its own so it starts under the icon and ends with the content,
   * which is what makes a run of sections read as one column rather than a
   * stack of unrelated blocks.
   */
  body: css`
    margin-inline-start: 15px;
    padding-inline-start: 25px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  /** The last section has nothing below it, so its rail would end in mid-air. */
  bodyLast: css`
    border-inline-start-color: transparent;
  `,
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
  <Flexbox>
    <Flexbox horizontal align={'center'} gap={12}>
      <span className={styles.icon}>
        <Icon icon={icon} size={15} />
      </span>
      <Text weight={600}>{title}</Text>
    </Flexbox>
    <Flexbox className={last ? `${styles.body} ${styles.bodyLast}` : styles.body} gap={12}>
      {(desc || notice) && (
        <Flexbox gap={4} paddingBlock={'8px 0'}>
          {desc && (
            <Text fontSize={12} type={'secondary'}>
              {desc}
            </Text>
          )}
          {notice}
        </Flexbox>
      )}
      <Flexbox gap={16} paddingBlock={'4px 24px'}>
        {children}
      </Flexbox>
    </Flexbox>
  </Flexbox>
));

PanelSection.displayName = 'PanelSection';

export default PanelSection;
