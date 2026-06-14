'use client';

import { ActionIcon, Flexbox, Popover, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderInput } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import AgentItem from '@/features/PageEditor/Copilot/AgentSelector/AgentItem';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { useTopicsViewStore } from './store';

const styles = createStaticStyles(({ css }) => ({
  searchInput: css`
    width: 100%;
    padding-block: 6px;
    padding-inline: 10px;
    border: none;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: inherit;
    font-size: 13px;
    color: ${cssVar.colorText};

    background: transparent;
    outline: none;

    &::placeholder {
      color: ${cssVar.colorTextPlaceholder};
    }
  `,
}));

const MoveToAgentButton = memo(() => {
  const { t } = useTranslation(['topic', 'chat']);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedIds = useTopicsViewStore((s) => s.selectedIds);
  const exitSelectMode = useTopicsViewStore((s) => s.exitSelectMode);

  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const batchMoveTopicsToAgent = useChatStore((s) => s.batchMoveTopicsToAgent);

  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);

  useFetchAgentList();

  // Source agent is excluded — moving topics back to where they already live
  // would be a no-op.
  const targetAgents = useMemo(
    () => agents.filter((a) => a.type === 'agent' && a.id !== activeAgentId),
    [agents, activeAgentId],
  );

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return targetAgents;
    return targetAgents.filter((a) => (a.title || '').toLowerCase().includes(q));
  }, [targetAgents, search]);

  const handleMove = async (targetAgentId: string) => {
    const count = selectedIds.length;
    setOpen(false);
    await batchMoveTopicsToAgent(selectedIds, targetAgentId);
    exitSelectMode();
    message.success(t('management.bulk.moveSuccess', { count }));
  };

  return (
    <Popover
      open={open}
      placement={'top'}
      styles={{ content: { padding: 0, width: 260 } }}
      trigger={'click'}
      content={
        isAgentListInit ? (
          <Flexbox>
            <input
              autoFocus
              className={styles.searchInput}
              placeholder={t('management.bulk.moveSearchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {filteredAgents.length === 0 ? (
              <Flexbox align={'center'} justify={'center'} padding={16}>
                <Text fontSize={12} type={'secondary'}>
                  {t('management.bulk.moveEmpty')}
                </Text>
              </Flexbox>
            ) : (
              <Flexbox
                gap={4}
                padding={8}
                style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
              >
                {filteredAgents.map((agent) => (
                  <AgentItem
                    active={false}
                    agentId={agent.id}
                    agentTitle={agent.title || t('untitledAgent', { ns: 'chat' })}
                    avatar={agent.avatar}
                    key={agent.id}
                    onAgentChange={handleMove}
                    onClose={() => setOpen(false)}
                  />
                ))}
              </Flexbox>
            )}
          </Flexbox>
        ) : (
          <SkeletonList rows={6} />
        )
      }
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <ActionIcon icon={FolderInput} size={'small'} title={t('management.bulk.move')} />
    </Popover>
  );
});

MoveToAgentButton.displayName = 'AgentTopicManagerMoveToAgentButton';

export default MoveToAgentButton;
