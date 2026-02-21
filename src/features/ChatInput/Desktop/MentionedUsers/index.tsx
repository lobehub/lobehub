import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { useMentionStore } from '@/store/mention';
import { mentionSelectors } from '@/store/mention/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import MentionedUserItem from './MentionedUserItem';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-x: scroll;

    width: 100%;
    border-start-start-radius: 8px;
    border-start-end-radius: 8px;

    background: color-mix(in srgb, ${cssVar.colorBgLayout} 99%, white);
  `,
}));

const MentionedUsers = memo(() => {
  const currentSession = useSessionStore(sessionSelectors.currentSession);
  const mentionedUsers = useMentionStore(mentionSelectors.mentionedUsers);
  const hasMentionedUsers = useMentionStore(mentionSelectors.hasMentionedUsers);

  if (currentSession?.type !== 'group' || !hasMentionedUsers) return null;

  const mentionedAgents = currentSession.members?.filter(
    (agent) => agent.id && mentionedUsers.includes(agent.id),
  );

  if (mentionedAgents?.length === 0) return null;

  return (
    <Flexbox
      horizontal
      className={styles.container}
      gap={6}
      padding={hasMentionedUsers ? '16px 16px 12px' : 0}
    >
      {mentionedAgents?.map((agent) => (
        <MentionedUserItem agent={agent} key={agent.id} />
      ))}
    </Flexbox>
  );
});

export default MentionedUsers;
