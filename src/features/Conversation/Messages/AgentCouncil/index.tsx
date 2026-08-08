'use client';

import { type UIChatMessage } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
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
            <Tabs
              activeKey={String(activeTab)}
              size="small"
              items={members.map((_, idx) => ({
                icon: <Icon icon={BotIcon} size={14} />,
                key: String(idx),
                label: null,
              }))}
              onChange={(key) => setActiveTab(Number(key))}
            />
          ) : (
            <div />
          )}
          <Tabs
            activeKey={displayMode}
            size="small"
            items={[
              { icon: <Icon icon={Columns2} />, key: 'horizontal', label: null },
              { icon: <Icon icon={Layers} />, key: 'tab', label: null },
            ]}
            onChange={(key) => setDisplayMode(key as DisplayMode)}
          />
        </Flexbox>
      </WideScreenContainer>
      <CouncilList activeTab={activeTab} displayMode={displayMode} members={members} />
    </>
  );
}, isEqual);

export default AgentCouncilMessage;
