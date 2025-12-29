'use client';

import { Avatar, Flexbox, Text , Checkbox } from '@lobehub/ui';
import { useHover } from 'ahooks';
import { createStaticStyles } from 'antd-style';
import { X } from 'lucide-react';
import { memo, useRef } from 'react';

import { DEFAULT_AVATAR } from '@/const/meta';

import { useAgentSelectionStore } from './store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    cursor: pointer;

    margin-block: 1px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background 0.2s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  removeButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    transition: all 0.2s ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  title: css`
    overflow: hidden;
    flex: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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

  const title = agent.title || defaultTitle;
  const avatar = agent.avatar || DEFAULT_AVATAR;
  const avatarBackground = agent.backgroundColor ?? undefined;

  const handleClick = () => {
    toggleAgent(agent.id);
  };

  const handleRemove = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    removeAgent(agent.id);
  };

  return (
    <div
      className={styles.item}
      onClick={showCheckbox ? handleClick : undefined}
      ref={ref}
      style={{ cursor: showCheckbox ? 'pointer' : 'default' }}
    >
      <Flexbox align="center" gap={8} horizontal width="100%">
        {showCheckbox && (
          <Checkbox
            checked={isSelected}
            onChange={handleClick}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <Avatar
          animation={isHovering}
          avatar={avatar}
          background={avatarBackground}
          emojiScaleWithBackground
          size={28}
        />
        <Text className={styles.title} ellipsis>
          {title}
        </Text>
        {showRemove && (
          <div className={styles.removeButton} onClick={handleRemove}>
            <X size={14} />
          </div>
        )}
      </Flexbox>
    </div>
  );
});

export default AgentItem;
