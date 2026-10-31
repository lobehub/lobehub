'use client';

import { Block, createModal, Flexbox, Input, Text, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as translate } from 'i18next';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { topicService } from '@/services/topic';

const styles = stylex.create({
  row: {
    cursor: 'pointer',
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
});

interface PickableTopic {
  agentTitle?: string | null;
  id: string;
  title: string | null;
  updatedAt?: Date | number | string | null;
}

const formatDay = (value?: Date | number | string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};

/**
 * Picks one of the account's conversations to draft a case from: the recent
 * ones by default, or a keyword search across all of them.
 */
const ConversationPicker = memo<{ onPick: (topicId: string) => void }>(({ onPick }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const [keywords, setKeywords] = useState('');
  const [topics, setTopics] = useState<PickableTopic[]>();

  const loadRecent = async () => {
    const list = await topicService.getRecentTopics(30);
    setTopics(
      list
        .filter((topic) => topic.type === 'agent')
        .map((topic) => ({
          agentTitle: topic.agent?.title,
          id: topic.id,
          title: topic.title,
          updatedAt: topic.updatedAt,
        })),
    );
  };

  useEffect(() => {
    loadRecent().catch(() => setTopics([]));
  }, []);

  const search = async () => {
    const query = keywords.trim();
    setTopics(undefined);
    try {
      if (!query) return await loadRecent();
      const list = await topicService.searchTopics(query);
      setTopics(
        list.map((topic) => ({ id: topic.id, title: topic.title, updatedAt: topic.updatedAt })),
      );
    } catch {
      setTopics([]);
    }
  };

  return (
    <Flexbox gap={12}>
      <Text type={'secondary'}>{t('lobeBench.case.fromConversation.hint')}</Text>
      <Input
        placeholder={t('lobeBench.case.fromConversation.search')}
        value={keywords}
        variant={'filled'}
        onChange={(e) => setKeywords(e.target.value)}
        onPressEnter={search}
      />
      <Block padding={4} style={{ maxHeight: 400, overflowY: 'auto' }} variant={'outlined'}>
        {!topics ? (
          <Text style={{ padding: 12 }} type={'secondary'}>
            …
          </Text>
        ) : topics.length === 0 ? (
          <Text style={{ padding: 12 }} type={'secondary'}>
            {t('lobeBench.case.fromConversation.empty')}
          </Text>
        ) : (
          topics.map((topic) => (
            <Flexbox
              className={stylex.props(styles.row).className}
              gap={2}
              key={topic.id}
              onClick={() => {
                onPick(topic.id);
                close();
              }}
            >
              <Text ellipsis weight={500}>
                {topic.title || topic.id}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {[topic.agentTitle, formatDay(topic.updatedAt)].filter(Boolean).join(' · ')}
              </Text>
            </Flexbox>
          ))
        )}
      </Block>
    </Flexbox>
  );
});

ConversationPicker.displayName = 'LobeBenchConversationPicker';

export const openConversationPicker = (onPick: (topicId: string) => void) =>
  createModal({
    content: <ConversationPicker onPick={onPick} />,
    footer: null,
    title: translate('lobeBench.case.fromConversation', { ns: 'eval' }),
    width: 560,
  });

export default ConversationPicker;
