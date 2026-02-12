'use client';

import { type UIChatMessage } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Segmented } from 'antd';
import isEqual from 'fast-deep-equal';
import { BotIcon, Columns2, Layers } from 'lucide-react';
import { memo, useState } from 'react';

import WideScreenContainer from '@/features/WideScreenContainer';

import { dataSelectors, useConversationStore } from '../../store';
import CouncilList from './components/CouncilList';

export type DisplayMode = 'horizontal' | 'tab';

interface AgentCouncilMessageProps {
  id: string;
  index: number;
  isLatestItem?: boolean;
}

const AgentCouncilMessage = memo<AgentCouncilMessageProps>(({ id }) => {
  const [displayMode, setDisplayMode] = useState<DisplayMode>('horizontal');
  const [activeTab, setActiveTab] = useState(0);
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;
  const members = (item as UIChatMessage)?.members?.filter(Boolean) as UIChatMessage[] | undefined;
  if (!members || members.length === 0) {
    return null;
  }

  return (
    <>
      <WideScreenContainer>
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          height={48}
          justify={'space-between'}
          paddingBlock={8}
        >
          {displayMode === 'tab' ? (
            <Segmented
              size={'small'}
              value={activeTab}
              options={members.map((_, idx) => {
                return {
                  icon: <Icon icon={BotIcon} size={14} />,
                  value: idx,
                };
              })}
              onChange={(value) => setActiveTab(Number(value))}
            />
          ) : (
            <div />
          )}
          <Segmented
            size="small"
            value={displayMode}
            options={[
              { icon: <Icon icon={Columns2} />, value: 'horizontal' },
              { icon: <Icon icon={Layers} />, value: 'tab' },
            ]}
            onChange={(value) => setDisplayMode(value as DisplayMode)}
          />
        </Flexbox>
      </WideScreenContainer>
      <CouncilList activeTab={activeTab} displayMode={displayMode} members={members} />
    </>
  );
}, isEqual);

export default AgentCouncilMessage;
