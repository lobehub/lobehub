'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight } from 'lucide-react';
import { memo, useCallback } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { type MarkdownElementProps } from '../../type';

const styles = stylex.create({
  arrowIcon: { flexShrink: 0, color: cssVar.colorTextTertiary },
  card: {
    cursor: 'pointer',
    paddingBlock: '14px',
    paddingInline: '14px',
    borderRadius: '10px',
    backgroundColor: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'background 0.15s',
  },
  description: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  content: { minWidth: '0' },
  title: {
    overflow: 'hidden',
    fontSize: '14px',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface LobeAgentsProps extends MarkdownElementProps {
  avatar?: string;
  backgroundColor?: string;
  description?: string;
  identifier: string;
  title: string;
}

const Render = memo<LobeAgentsProps>(
  ({ identifier, title, description, avatar, backgroundColor }) => {
    const navigate = useWorkspaceAwareNavigate();

    const handleClick = useCallback(() => {
      if (!identifier) return;
      navigate(AGENT_CHAT_URL(identifier));
    }, [navigate, identifier]);

    if (!identifier) return null;

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.card).className}
        gap={12}
        onClick={handleClick}
      >
        <AgentAvatar
          agentId={identifier}
          avatar={avatar}
          background={backgroundColor}
          name={title || undefined}
          size={40}
          title={title || undefined}
        />
        <Flexbox className={stylex.props(styles.content).className} flex={1} gap={4}>
          <span {...stylex.props(styles.title)}>{title || identifier}</span>
          {description && <span {...stylex.props(styles.description)}>{description}</span>}
        </Flexbox>
        <ArrowRight className={stylex.props(styles.arrowIcon).className} size={16} />
      </Flexbox>
    );
  },
);

Render.displayName = 'LobeAgentsRender';

export default Render;
