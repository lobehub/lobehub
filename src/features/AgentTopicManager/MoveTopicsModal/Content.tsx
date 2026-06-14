'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { Spin } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleCheck } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import AgentItem from '@/features/PageEditor/Copilot/AgentSelector/AgentItem';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

type Step = 'pick' | 'confirm' | 'moving' | 'done';

export interface MoveTopicsContentProps {
  /** Called after the move succeeds (e.g. to exit multi-select mode). */
  onMoved?: () => void;
  /** Source agent — excluded from the picker so a no-op move can't be chosen. */
  sourceAgentId?: string | null;
  topicIds: string[];
}

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

const MoveTopicsContent = memo<MoveTopicsContentProps>(({ onMoved, sourceAgentId, topicIds }) => {
  const { t } = useTranslation(['topic', 'chat', 'common']);
  const { close, setCanDismissByClickOutside } = useModalContext();

  const [step, setStep] = useState<Step>('pick');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null);

  const batchMoveTopicsToAgent = useChatStore((s) => s.batchMoveTopicsToAgent);
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);

  useFetchAgentList();

  const count = topicIds.length;

  // Source agent is excluded — moving topics back to where they already live
  // would be a no-op.
  const targetAgents = useMemo(
    () => agents.filter((a) => a.type === 'agent' && a.id !== sourceAgentId),
    [agents, sourceAgentId],
  );

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return targetAgents;
    return targetAgents.filter((a) => (a.title || '').toLowerCase().includes(q));
  }, [targetAgents, search]);

  const handleConfirm = async () => {
    if (!target) return;
    setStep('moving');
    // Lock dismissal so the move can't be interrupted mid-flight.
    setCanDismissByClickOutside?.(false);
    try {
      await batchMoveTopicsToAgent(topicIds, target.id);
      onMoved?.();
      setStep('done');
    } catch (error) {
      console.error('[MoveTopics] move failed:', error);
      message.error(t('management.moveModal.error'));
      setStep('confirm');
    } finally {
      setCanDismissByClickOutside?.(true);
    }
  };

  if (step === 'pick') {
    return (
      <Flexbox>
        <input
          autoFocus
          className={styles.searchInput}
          placeholder={t('management.bulk.moveSearchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!isAgentListInit ? (
          <SkeletonList rows={6} />
        ) : filteredAgents.length === 0 ? (
          <Flexbox align={'center'} justify={'center'} padding={24}>
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
                onClose={() => {}}
                onAgentChange={() => {
                  setTarget({
                    id: agent.id,
                    title: agent.title || t('untitledAgent', { ns: 'chat' }),
                  });
                  setStep('confirm');
                }}
              />
            ))}
          </Flexbox>
        )}
      </Flexbox>
    );
  }

  if (step === 'confirm') {
    return (
      <Flexbox gap={20} padding={24}>
        <Text>{t('management.moveModal.confirmContent', { count, title: target?.title })}</Text>
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button onClick={() => setStep('pick')}>{t('management.moveModal.back')}</Button>
          <Button type={'primary'} onClick={handleConfirm}>
            {t('management.moveModal.confirmOk')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  }

  if (step === 'moving') {
    return (
      <Flexbox align={'center'} gap={16} justify={'center'} padding={48}>
        <Spin />
        <Text type={'secondary'}>{t('management.moveModal.moving')}</Text>
      </Flexbox>
    );
  }

  // done
  return (
    <Flexbox align={'center'} gap={16} justify={'center'} padding={48}>
      <Icon color={cssVar.colorSuccess} icon={CircleCheck} size={32} />
      <Text weight={500}>{t('management.moveModal.done', { count })}</Text>
      <Button type={'primary'} onClick={close}>
        {t('management.moveModal.doneOk')}
      </Button>
    </Flexbox>
  );
});

MoveTopicsContent.displayName = 'MoveTopicsContent';

export default MoveTopicsContent;
