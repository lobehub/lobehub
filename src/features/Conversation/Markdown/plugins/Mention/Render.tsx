'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MentionProfileTrigger from '@/features/MemberProfileCard/MentionProfileTrigger';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import { type MarkdownElementProps } from '../type';

const styles = stylex.create({
  mention: {
    cursor: 'pointer',
    position: 'relative',
    display: 'inline',
    marginInline: '0.25em',
    paddingBlock: '0.2em',
    paddingInline: '0.4em',
    borderRadius: '0.25em',
    fontSize: '0.875em',
    lineHeight: 1,
    color: cssVar.colorInfo,
    wordBreak: 'break-word',
    whiteSpace: 'break-spaces',
    backgroundColor: {
      'default': cssVar.colorInfoBg,
      ':hover': `color-mix(in srgb, ${cssVar.colorInfo} 15%, ${cssVar.colorBgContainer})`,
    },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
});

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
      <span {...stylex.props(styles.mention)}>
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
      <span {...stylex.props(styles.mention)}>
        {'@'}
        {label}
      </span>
    </MentionProfileTrigger>
  );
});

Render.displayName = 'MentionRender';

export default Render;
