'use client';

import { Flexbox, Popover, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
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

  // Find the specific member
  const member = currentGroupMembers?.find((m) => m.id === mentionId);

  if (!member) {
    // Fallback for unknown member
    return (
      <span {...stylex.props(styles.mention)}>
        {'@'}
        {name || children || 'unknown'}
      </span>
    );
  }

  return (
    <Popover
      trigger="click"
      content={
        <Flexbox gap={12} style={{ overflow: 'hidden' }} width={320}>
          <Flexbox horizontal align="center" gap={8}>
            <AgentAvatar
              agentId={member.id}
              avatar={member.avatar}
              background={member.backgroundColor ?? undefined}
              name={member.title || name}
              size={40}
              style={{ flex: 'none' }}
            />
            <Flexbox style={{ overflow: 'hidden' }}>
              <Text ellipsis type={'secondary'}>
                {member.description}
              </Text>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      }
    >
      <span {...stylex.props(styles.mention)}>
        {'@'}
        {member.title || name || children}
      </span>
    </Popover>
  );
});

Render.displayName = 'MentionRender';

export default Render;
