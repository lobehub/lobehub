'use client';

import { agentDisplayName } from '@lobechat/types';
import { Checkbox, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useHover } from 'ahooks';
import { X } from 'lucide-react';
import { memo, useRef } from 'react';

import AgentAvatar from '@/components/AgentAvatar';

import { useAgentSelectionStore } from './store';

const styles = stylex.create({
  item: {
    cursor: 'pointer',
    marginBlock: '1px',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    transition: 'background 0.2s ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  removeButton: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    transition: 'all 0.2s ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  title: { overflow: 'hidden', flex: '1', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

export interface AgentItemData {
  avatar: string | null;
  backgroundColor: string | null;
  description: string | null;
  id: string;
  title: string | null;
}

interface AgentItemProps {
  agent: AgentItemData;
  defaultTitle: string;
  showCheckbox?: boolean;
  showRemove?: boolean;
}

const AgentItem = memo<AgentItemProps>(({ agent, defaultTitle, showCheckbox, showRemove }) => {
  const ref = useRef(null);
  const isHovering = useHover(ref);

  const isSelected = useAgentSelectionStore((s) => s.selectedAgentIds.includes(agent.id));
  const toggleAgent = useAgentSelectionStore((s) => s.toggleAgent);
  const removeAgent = useAgentSelectionStore((s) => s.removeAgent);

  const title = agentDisplayName(agent, defaultTitle);

  const handleClick = () => {
    toggleAgent(agent.id);
  };

  const handleRemove = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    removeAgent(agent.id);
  };

  return (
    <div
      className={stylex.props(styles.item).className}
      ref={ref}
      style={{ cursor: showCheckbox ? 'pointer' : 'default' }}
      onClick={showCheckbox ? handleClick : undefined}
    >
      <Flexbox horizontal align="center" gap={8} width="100%">
        {showCheckbox && (
          <Checkbox
            checked={isSelected}
            onChange={handleClick}
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
            }}
          />
        )}
        <AgentAvatar
          agentId={agent.id}
          animation={isHovering}
          avatar={agent.avatar}
          background={agent.backgroundColor ?? undefined}
          name={title}
          shape="circle"
          size={28}
        />
        <Text ellipsis className={stylex.props(styles.title).className}>
          {title}
        </Text>
        {showRemove && (
          <div {...stylex.props(styles.removeButton)} onClick={handleRemove}>
            <X size={14} />
          </div>
        )}
      </Flexbox>
    </div>
  );
});

export default AgentItem;
