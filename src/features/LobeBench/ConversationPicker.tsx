'use client';

import { Block, createModal, Flexbox, Input, Text, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { useEvalStore } from '@/store/eval';

const styles = stylex.create({
  row: {
    cursor: 'pointer',
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
});

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
  const [submittedQuery, setSubmittedQuery] = useState('');
  const useFetchConversationTopics = useEvalStore((s) => s.useFetchConversationTopics);
  const {
    data: topics,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useFetchConversationTopics(submittedQuery);
  // SWR retains the failure for the error surface; don't leave an unhandled rejection.
  const retry = () => void mutate().catch(() => undefined);

  const search = () => {
    const query = keywords.trim();
    if (query === submittedQuery) retry();
    else setSubmittedQuery(query);
  };

  return (
    <Flexbox gap={12}>
      <Text type={'secondary'}>{t('lobeBench.case.fromConversation.hint')}</Text>
      <Input
        aria-label={t('lobeBench.case.fromConversation.search')}
        placeholder={t('lobeBench.case.fromConversation.search')}
        value={keywords}
        variant={'filled'}
        onChange={(e) => setKeywords(e.target.value)}
        onPressEnter={search}
      />
      <Block padding={4} style={{ maxHeight: 400, overflowY: 'auto' }} variant={'outlined'}>
        <AsyncBoundary
          data={topics}
          error={error}
          errorVariant={'inline'}
          isEmpty={topics?.length === 0}
          isLoading={isLoading || (topics === undefined && isValidating)}
          empty={
            <Text style={{ padding: 12 }} type={'secondary'}>
              {t('lobeBench.case.fromConversation.empty')}
            </Text>
          }
          onRetry={retry}
        >
          {topics?.map((topic) => (
            <Flexbox
              className={stylex.props(styles.row).className}
              gap={2}
              key={topic.id}
              role={'button'}
              tabIndex={0}
              onClick={() => {
                onPick(topic.id);
                close();
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
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
          ))}
        </AsyncBoundary>
        {topics !== undefined && !!error && (
          <AsyncError error={error} retrying={isValidating} variant={'inline'} onRetry={retry} />
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
