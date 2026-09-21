'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { MessagesSquare } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { useOriginConversation } from './originConversation';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: pointer;

    padding: 0;
    border: 0;

    font: inherit;
    color: ${cssVar.colorTextSecondary};

    background: none;

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }
  `,
}));

const AcceptanceOriginTopic = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const originConversation = useOriginConversation();
  const openTopic = useCallback(() => {
    if (!originConversation || !data?.origin?.topic) return;
    originConversation.openTopicDrawer(data.origin.topic.id, {
      agentId: data.origin.agent?.id,
      title: data.origin.topic.title ?? data.subject.title ?? data.origin.topic.id,
    });
  }, [data, originConversation]);

  if (embedded || !data?.origin?.topic || !originConversation) return null;

  return (
    <button
      className={cx(styles.chip)}
      title={t('acceptance.origin.openTopic')}
      type={'button'}
      onClick={openTopic}
    >
      <Flexbox horizontal align={'center'} gap={4}>
        <Icon icon={MessagesSquare} size={13} />
        {data.origin.topic.title ?? data.subject.title ?? data.origin.topic.id}
      </Flexbox>
    </button>
  );
};

export default AcceptanceOriginTopic;
