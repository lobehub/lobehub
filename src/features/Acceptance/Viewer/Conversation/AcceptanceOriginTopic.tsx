'use client';

import { createStaticStyles, cssVar, cx, Flexbox, Icon } from '@lobehub/ui';
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
  // A collaborator never sees the owner's topic id; the bundle names the
  // conversation for them, and the rail reads it through the acceptance.
  const collaborationTitle = data?.canCollaborate
    ? (data.collaboration?.topicTitle ?? data.subject.title ?? undefined)
    : undefined;
  const openTopic = useCallback(() => {
    if (!originConversation || !data) return;
    if (data.origin?.topic) {
      originConversation.openTopicDrawer(data.origin.topic.id, {
        agentId: data.origin.agent?.id,
        title: data.origin.topic.title ?? data.subject.title ?? data.origin.topic.id,
      });
      return;
    }
    if (data.collaboration) originConversation.openTopicDrawer('', { title: collaborationTitle });
  }, [collaborationTitle, data, originConversation]);

  const title = data?.origin?.topic
    ? (data.origin.topic.title ?? data.subject.title ?? data.origin.topic.id)
    : data?.collaboration
      ? collaborationTitle
      : undefined;
  if (embedded || !title || !originConversation) return null;

  return (
    <button
      className={cx(styles.chip)}
      title={t('acceptance.origin.openTopic')}
      type={'button'}
      onClick={openTopic}
    >
      <Flexbox horizontal align={'center'} gap={4}>
        <Icon icon={MessagesSquare} size={13} />
        {title}
      </Flexbox>
    </button>
  );
};

export default AcceptanceOriginTopic;
