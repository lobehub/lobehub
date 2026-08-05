'use client';

import { Flexbox, SearchBar, Text, TextArea } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import AgentAvatar from '@/routes/(main)/home/_layout/Body/Agent/List/AgentItem/Avatar';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import SelectCircle from '../SelectCircle';
import type { ForwardTarget } from '../useForwardMessages';
import { useForwardTopic } from '../useForwardTopic';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    block-size: 460px;
  `,
  context: css`
    flex: 1;

    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  divider: css`
    align-self: stretch;
    inline-size: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  list: css`
    overflow-y: auto;
    flex: 1;
  `,
  row: css`
    cursor: pointer;

    min-block-size: 44px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusLG};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  selected: css`
    background: ${cssVar.colorFillQuaternary};
  `,
}));

export interface TopicForwardContentProps {
  sourceAgentId: string;
  topicId: string;
  topicTitle: string;
}

export const TopicForwardContent = ({
  sourceAgentId,
  topicId,
  topicTitle,
}: TopicForwardContentProps) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const [keyword, setKeyword] = useState('');
  const [note, setNote] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const forwardTopic = useForwardTopic({ agentId: sourceAgentId, topicId });

  useFetchAgentList();

  const candidates = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return agents
      .filter((agent) => agent.type === 'agent' && agent.id !== sourceAgentId)
      .filter((agent) => !query || (agent.title || '').toLowerCase().includes(query));
  }, [agents, keyword, sourceAgentId]);

  const handleForward = () => {
    const targets: ForwardTarget[] = selectedIds
      .map((id) => agents.find((agent) => agent.id === id))
      .filter((agent): agent is NonNullable<typeof agent> => !!agent)
      .map((agent) => ({ id: agent.id, title: agent.title }));
    if (targets.length === 0) return;

    forwardTopic(targets, note);
    close();
  };

  return (
    <Flexbox horizontal className={styles.body} gap={16}>
      <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
        <SearchBar
          allowClear
          placeholder={t('messageForward.modal.searchPlaceholder')}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Flexbox className={styles.list} gap={4}>
          {candidates.length === 0 ? (
            <Flexbox align={'center'} justify={'center'} padding={24}>
              <Text type={'secondary'}>{t('messageForward.modal.empty')}</Text>
            </Flexbox>
          ) : (
            candidates.map((agent) => {
              const selected = selectedIds.includes(agent.id);
              return (
                <Flexbox
                  horizontal
                  align={'center'}
                  className={cx(styles.row, selected && styles.selected)}
                  gap={8}
                  key={agent.id}
                  onClick={() =>
                    setSelectedIds((ids) =>
                      selected ? ids.filter((id) => id !== agent.id) : [...ids, agent.id],
                    )
                  }
                >
                  <AgentAvatar
                    avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
                  />
                  <Text ellipsis style={{ flex: 1 }}>
                    {agent.title || t('untitledAgent')}
                  </Text>
                  <SelectCircle checked={selected} />
                </Flexbox>
              );
            })
          )}
        </Flexbox>
      </Flexbox>

      <div className={styles.divider} />

      <Flexbox flex={1} gap={12} style={{ minWidth: 0 }}>
        <Text type={'secondary'}>{t('messageForward.topic.context')}</Text>
        <Flexbox className={styles.context} gap={8}>
          <Text ellipsis strong>
            {topicTitle}
          </Text>
          <Text type={'secondary'}>{t('messageForward.topic.description')}</Text>
        </Flexbox>
        <TextArea
          autoSize={{ maxRows: 4, minRows: 2 }}
          placeholder={t('messageForward.modal.notePlaceholder')}
          resize={false}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button onClick={close}>{t('messageForward.bar.cancel')}</Button>
          <Button disabled={selectedIds.length === 0} type={'primary'} onClick={handleForward}>
            {selectedIds.length > 0
              ? t('messageForward.modal.sendCount', { count: selectedIds.length })
              : t('messageForward.bar.forward')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
