import { Avatar, Block, createStaticStyles, cssVar, Icon, Text } from '@lobehub/ui';
import { CheckIcon } from 'lucide-react';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';

import type { SwitcherItem } from './switcherItems';

const styles = createStaticStyles(({ css, cssVar }) => ({
  current: css`
    background: ${cssVar.colorFillTertiary};
  `,
  row: css`
    cursor: pointer;

    overflow: hidden;
    flex: none;

    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

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
    className={active ? `${styles.row} ${styles.current}` : styles.row}
    flex={'none'}
    gap={8}
    height={36}
    variant={'borderless'}
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
