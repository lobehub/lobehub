import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const styles = stylex.create({
  done: {
    color: cssVar.colorTextTertiary,
    textDecorationLine: 'line-through',
  },
  row: {
    borderBlockStartColor: {
      'default': cssVar.colorBorderSecondary,
      ':first-child': 'transparent',
    },
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    minHeight: 44,
    paddingBlock: 8,
  },
  status: {
    alignItems: 'center',
    borderColor: cssVar.colorBorder,
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: 1.5,
    display: 'flex',
    flexShrink: 0,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  statusDone: {
    backgroundColor: cssVar.colorSuccess,
    borderColor: cssVar.colorSuccess,
    color: cssVar.colorBgContainer,
  },
});

interface BasicRowProps {
  actions?: ReactNode;
  done: boolean;
  title: string;
}

const BasicRow = ({ actions, done, title }: BasicRowProps) => (
  <Flexbox horizontal align="center" gap={10} {...stylex.props(styles.row)}>
    <span {...stylex.props(styles.status, done && styles.statusDone)}>
      {done ? <Icon icon={CheckIcon} size={11} /> : null}
    </span>
    <Text fontSize={13} {...stylex.props(done && styles.done)}>
      {title}
    </Text>
    {done || !actions ? null : (
      <Flexbox horizontal gap={8} style={{ marginInlineStart: 'auto' }}>
        {actions}
      </Flexbox>
    )}
  </Flexbox>
);

export default BasicRow;
