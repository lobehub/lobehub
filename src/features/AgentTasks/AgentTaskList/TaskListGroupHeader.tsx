import {
  AccordionHeader,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
  cssVar,
  Divider,
  Flexbox,
  Text,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import { useDensityTokens, useInterfaceDensity } from '@/styles/density';

import AccordionArrowIcon from '../shared/AccordionArrowIcon';

/** Space above a non-first top-level group header; Compact stacks them like Linear. */
const GROUP_GAP = { compact: 4, loose: 16 } as const;

/** Room kept at the title's end for the header action, so a sub-group rule stops before it. */
const ACTION_GUTTER = 28;

const styles = stylex.create({
  // A flex box centres the action instead of a transform on the action itself,
  // which its own pressed / focused styles would override.
  action: {
    alignItems: 'center',
    display: 'flex',
    insetBlock: 0,
    insetInlineEnd: 10,
    position: 'absolute',
  },
  header: {
    position: 'relative',
  },
});

interface TaskListGroupHeaderProps {
  /** Header end entry (e.g. create a task in this group), kept outside the toggle. */
  action?: ReactNode;
  collapsed: boolean;
  count: number;
  /** The first header of the list takes no space above it. */
  first?: boolean;
  groupKey: string;
  onToggle: () => void;
  /** Sub-group: borderless, tighter, with a rule after the count. */
  sub?: boolean;
  /** Group icon and name. */
  title: ReactNode;
}

/**
 * Group / sub-group header shared by every task list view (the ordinary list
 * and the scheduled table), so spacing, the collapse indicator and the count
 * follow one look (like Linear). A standalone, context-free AccordionItem: the
 * caller owns the expand state and renders the rows it opens.
 */
const TaskListGroupHeader = ({
  action,
  collapsed,
  count,
  first,
  groupKey,
  onToggle,
  sub,
  title,
}: TaskListGroupHeaderProps) => {
  const density = useInterfaceDensity();
  const { fontSize } = useDensityTokens();

  return (
    <div style={{ paddingTop: first ? 0 : sub ? 6 : GROUP_GAP[density] }}>
      <div {...stylex.props(styles.header)}>
        {/* The built-in chevron is hidden for the small filled triangle the task
            detail sections and the sidebar use (like Linear). */}
        <AccordionRoot
          hideIndicator
          value={collapsed ? [] : [groupKey]}
          variant={sub ? 'borderless' : 'filled'}
          onValueChange={onToggle}
        >
          <AccordionItem value={groupKey}>
            <AccordionHeader>
              <AccordionTrigger style={{ paddingBlock: sub ? 6 : 8, paddingInline: 10 }}>
                <Flexbox horizontal align={'center'} flex={1} gap={6}>
                  <AccordionArrowIcon
                    isOpen={!collapsed}
                    size={16}
                    style={{ color: cssVar.colorTextDescription }}
                  />
                  <Flexbox
                    horizontal
                    align={'center'}
                    flex={1}
                    gap={8}
                    justify={'space-between'}
                    style={action ? { marginInlineEnd: ACTION_GUTTER } : undefined}
                  >
                    {title}
                    {/* Same size as the title, muted by color only (like Linear). */}
                    <Text fontSize={fontSize} type={'secondary'}>
                      {count}
                    </Text>
                    {sub ? (
                      <Divider style={{ borderColor: cssVar.colorBorder, flex: 1 }} />
                    ) : (
                      <Flexbox flex={1} />
                    )}
                  </Flexbox>
                </Flexbox>
              </AccordionTrigger>
            </AccordionHeader>
          </AccordionItem>
        </AccordionRoot>
        {action && <div {...stylex.props(styles.action)}>{action}</div>}
      </div>
    </div>
  );
};

export default TaskListGroupHeader;
