'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleDashed } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  groupHeader: css`
    padding-block: 9px;
    padding-inline: 12px;
  `,
  list: css`
    overflow: hidden;
    width: 100%;
    padding: 0;
  `,
  row: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  seq: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export interface PendingAcceptanceCheckItem {
  id: string;
  title: string;
}

interface PendingAcceptanceCheckListProps {
  groupLabel: string;
  items: PendingAcceptanceCheckItem[];
  onOpen: (item: PendingAcceptanceCheckItem) => void;
}

/** The pre-run projection of Acceptance checks: same list grammar, pending verdicts. */
export const PendingAcceptanceCheckList = memo<PendingAcceptanceCheckListProps>(
  ({ groupLabel, items, onOpen }) => (
    <Block className={styles.list} variant={'outlined'}>
      <Flexbox horizontal align={'center'} className={styles.groupHeader} gap={8}>
        <Text fontSize={12}>{groupLabel}</Text>
        <Text fontSize={11} type={'secondary'}>
          {items.length}
        </Text>
      </Flexbox>
      {items.map((item, index) => (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.row}
          data-task-acceptance-criterion={item.id}
          gap={10}
          key={item.id}
          role={'button'}
          tabIndex={0}
          onClick={() => onOpen(item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onOpen(item);
          }}
        >
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={CircleDashed}
            size={16}
            style={{ flex: 'none' }}
          />
          <span className={styles.seq}>C{index + 1}</span>
          <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
            {item.title}
          </Text>
        </Flexbox>
      ))}
    </Block>
  ),
);

PendingAcceptanceCheckList.displayName = 'PendingAcceptanceCheckList';
