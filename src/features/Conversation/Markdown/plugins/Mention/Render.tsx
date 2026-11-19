'use client';

import { createStaticStyles } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MentionProfileTrigger from '@/features/MemberProfileCard/MentionProfileTrigger';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import { type MarkdownElementProps } from '../type';

const styles = createStaticStyles(({ css, cssVar }) => ({
  mention: css`
    cursor: pointer;

    position: relative;

    display: inline;

    margin-inline: 0.25em;
    padding-block: 0.2em;
    padding-inline: 0.4em;
    border-radius: 0.25em;

    font-size: 0.875em;
    line-height: 1;
    color: ${cssVar.colorInfo};
    word-break: break-word;
    white-space: break-spaces;

    background: ${cssVar.colorInfoBg};

    &:hover {
      background: color-mix(in srgb, ${cssVar.colorInfo} 15%, ${cssVar.colorBgContainer});
    }
  `,
}));

interface MentionProps {
  id: string;
  name: string;
}
const Render = memo<MarkdownElementProps<MentionProps>>(({ children, node }) => {
  const { id: mentionId, name } = node?.properties || {};
  const { t } = useTranslation('chat');

  const currentGroupMembers = useSessionStore(sessionSelectors.currentGroupAgents, isEqual);

  // Handle "ALL_MEMBERS" special case
  if (mentionId === 'ALL_MEMBERS') {
    return (
      <span className={styles.mention}>
        {'@'}
        {t('memberSelection.allMembers')}
      </span>
    );
  }

  // A group member resolves to its Agent at once; any other id (a workspace
  // member, an Agent outside this group) is looked up by the profile card.
  const member = currentGroupMembers?.find((m) => m.id === mentionId);
  const label = member?.title || name || children || 'unknown';

  return (
    <MentionProfileTrigger
      id={mentionId}
      type={member ? 'agent' : undefined}
      agent={
        member
          ? {
              avatar: member.avatar,
              backgroundColor: member.backgroundColor,
              description: member.description,
              title: member.title || name,
            }
          : { title: name }
      }
    >
      <span className={styles.mention}>
        {'@'}
        {label}
      </span>
    </MentionProfileTrigger>
  );
});

Render.displayName = 'MentionRender';

export default Render;
