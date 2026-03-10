'use client';

import { Avatar, Flexbox, Popover, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/index';
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
  const { id: mentionId } = node?.properties || {};
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

  // Find the specific member
  const member = currentGroupMembers?.find((m) => m.id === mentionId);

  if (!member) {
    // Fallback for unknown member
    return (
      <span className={styles.mention}>
        {'@'}
        {children || 'unknown'}
      </span>
    );
  }

  return (
    <Popover
      trigger="click"
      content={
        <Flexbox gap={12} style={{ overflow: 'hidden' }} width={320}>
          <Flexbox horizontal align="center" gap={8}>
            <Avatar
              avatar={member.avatar || DEFAULT_AVATAR}
              background={member.backgroundColor ?? undefined}
              shape={'square'}
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
      <span className={styles.mention}>
        {'@'}
        {member.title || children}
      </span>
    </Popover>
  );
});

Render.displayName = 'MentionRender';

export default Render;
