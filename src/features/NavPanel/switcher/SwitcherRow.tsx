import { Avatar, Block, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon } from 'lucide-react';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';

import type { SwitcherItem } from './switcherItems';

const styles = stylex.create({
  current: { backgroundColor: cssVar.colorFillTertiary, backgroundImage: 'none' },
  row: {
    cursor: 'pointer',
    overflow: 'hidden',
    flex: 'none',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

interface SwitcherRowProps {
  active?: boolean;
  item: SwitcherItem;
  kind?: 'agent' | 'project';
  onSelect: (id: string) => void;
  privateLabel?: string;
}

const SwitcherRow = memo<SwitcherRowProps>(({ active, item, kind, onSelect, privateLabel }) => (
  <Block
    clickable
    horizontal
    align={'center'}
    flex={'none'}
    gap={8}
    height={36}
    variant={'borderless'}
    className={
      active
        ? stylex.props(styles.row, styles.current).className
        : stylex.props(styles.row).className
    }
    onClick={() => onSelect(item.id)}
  >
    {kind === 'agent' ? (
      <AgentAvatar
        agentId={item.id}
        avatar={item.avatar}
        background={item.background}
        name={item.title}
        size={24}
        title={item.title}
      />
    ) : (
      <Avatar
        avatar={item.avatar}
        background={item.background}
        shape={'square'}
        size={24}
        title={item.title}
      />
    )}
    <Text
      ellipsis
      color={active ? cssVar.colorText : cssVar.colorTextSecondary}
      style={{ flex: 1 }}
      weight={active ? 500 : undefined}
    >
      {item.title}
      {item.subtitle && (
        <span style={{ fontSize: 12, marginInlineStart: 6, opacity: 0.6 }}>{item.subtitle}</span>
      )}
    </Text>
    {item.private && privateLabel && (
      <Text color={cssVar.colorTextTertiary} fontSize={12}>
        {privateLabel}
      </Text>
    )}
    {active && <Icon color={cssVar.colorText} icon={CheckIcon} size={14} />}
  </Block>
));

SwitcherRow.displayName = 'SwitcherRow';

export default SwitcherRow;
