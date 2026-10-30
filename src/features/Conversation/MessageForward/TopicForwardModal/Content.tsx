'use client';

import { Button, Flexbox, SearchBar, Text, TextArea, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import SelectCircle from '../SelectCircle';
import { useForwardTargets } from '../useForwardTargets';
import { useForwardTopic } from '../useForwardTopic';

const styles = stylex.create({
  body: { blockSize: '460px' },
  context: {
    flex: '1',
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  divider: {
    alignSelf: 'stretch',
    inlineSize: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  list: { overflowY: 'auto', flex: '1' },
  row: {
    cursor: 'pointer',
    minBlockSize: '44px',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  selected: { backgroundColor: cssVar.colorFillQuaternary, backgroundImage: 'none' },
});

export interface TopicForwardContentProps {
  cancelSourceContinuation?: boolean;
  sourceAgentId: string;
  topicId: string;
  topicTitle: string;
}

export const TopicForwardContent = ({
  cancelSourceContinuation,
  sourceAgentId,
  topicId,
  topicTitle,
}: TopicForwardContentProps) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const [note, setNote] = useState('');
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const { candidates, keyword, selectedIds, setKeyword, targets, toggle } = useForwardTargets(
    agents,
    sourceAgentId,
  );
  const forwardTopic = useForwardTopic({
    agentId: sourceAgentId,
    cancelSourceContinuation,
    topicId,
  });

  useFetchAgentList();

  const handleForward = () => {
    if (targets.length === 0) return;

    forwardTopic(targets, note);
    close();
  };

  return (
    <Flexbox horizontal className={stylex.props(styles.body).className} gap={16}>
      <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
        <SearchBar
          allowClear
          placeholder={t('messageForward.modal.searchPlaceholder')}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Flexbox className={stylex.props(styles.list).className} gap={4}>
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
                  className={stylex.props(styles.row, selected && styles.selected).className}
                  gap={8}
                  key={agent.id}
                  onClick={() => toggle(agent.id)}
                >
                  <AgentAvatar
                    agentId={agent.id}
                    avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
                    background={agent.backgroundColor || undefined}
                    name={agent.label || t('untitledAgent')}
                    size={22}
                  />
                  <Text ellipsis style={{ flex: 1 }}>
                    {agent.label || t('untitledAgent')}
                  </Text>
                  <SelectCircle checked={selected} />
                </Flexbox>
              );
            })
          )}
        </Flexbox>
      </Flexbox>

      <div {...stylex.props(styles.divider)} />

      <Flexbox flex={1} gap={12} style={{ minWidth: 0 }}>
        <Text type={'secondary'}>{t('messageForward.topic.context')}</Text>
        <Flexbox className={stylex.props(styles.context).className} gap={8}>
          <Text ellipsis strong>
            {topicTitle}
          </Text>
          <Text type={'secondary'}>{t('messageForward.topic.description')}</Text>
        </Flexbox>
        <TextArea
          autoSize={{ maxRows: 4, minRows: 2 }}
          resize={false}
          value={note}
          placeholder={t(
            cancelSourceContinuation
              ? 'messageForward.topic.handoff.notePlaceholder'
              : 'messageForward.modal.notePlaceholder',
          )}
          onChange={(event) => setNote(event.target.value)}
        />
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button onClick={close}>{t('messageForward.bar.cancel')}</Button>
          <Button disabled={selectedIds.length === 0} type={'primary'} onClick={handleForward}>
            {selectedIds.length > 0
              ? t(
                  cancelSourceContinuation
                    ? 'messageForward.topic.handoff.submitCount'
                    : 'messageForward.modal.sendCount',
                  { count: selectedIds.length },
                )
              : t(
                  cancelSourceContinuation
                    ? 'messageForward.topic.handoff.submit'
                    : 'messageForward.bar.forward',
                )}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
