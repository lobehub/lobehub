'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Avatar, Block, Flexbox, Markdown, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router';

import type { CreateAgentParams, CreateAgentState } from '../../../types';

const styles = stylex.create({
  agentCard: {
    cursor: 'pointer',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderRadius: '8px',
    background: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
    transition: 'background 0.2s',
  },
  agentDescription: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  agentTitle: { fontSize: '13px', fontWeight: 500 },
  arrowIcon: { color: cssVar.colorTextTertiary },
  container: { paddingBlock: '4px' },
  field: { marginBlockEnd: { 'default': '8px', ':last-child': '0' } },
  label: {
    marginBlockEnd: '4px',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  value: { fontSize: '13px' },
});

export const CreateAgentRender = memo<BuiltinRenderProps<CreateAgentParams, CreateAgentState>>(
  ({ args, pluginState }) => {
    const navigate = useNavigate();
    const { title, description, systemRole, plugins, model, provider, avatar, backgroundColor } =
      args || {};

    const handleNavigateToAgent = useCallback(() => {
      const targetId = pluginState?.agentId;
      if (!targetId) return;
      navigate(AGENT_CHAT_URL(targetId));
    }, [navigate, pluginState?.agentId]);

    // After tool execution succeeds, render a clickable agent card
    if (pluginState?.success && pluginState.agentId) {
      return (
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.agentCard).className}
          gap={12}
          onClick={handleNavigateToAgent}
        >
          <Avatar
            avatar={avatar || '🤖'}
            background={backgroundColor}
            shape={'square'}
            size={36}
            title={title || undefined}
          />
          <Flexbox flex={1} gap={2}>
            <span {...stylex.props(styles.agentTitle)}>{title}</span>
            {description && <span {...stylex.props(styles.agentDescription)}>{description}</span>}
          </Flexbox>
          <ArrowRight className={stylex.props(styles.arrowIcon).className} size={16} />
        </Flexbox>
      );
    }

    // While tool is still executing (no pluginState yet), show args preview
    if (!title && !description && !systemRole && !plugins?.length) return null;

    return (
      <div {...stylex.props(styles.container)}>
        {title && (
          <div {...stylex.props(styles.field)}>
            <div {...stylex.props(styles.label)}>Title</div>
            <div {...stylex.props(styles.value)}>{title}</div>
          </div>
        )}
        {description && (
          <div {...stylex.props(styles.field)}>
            <div {...stylex.props(styles.label)}>Description</div>
            <div {...stylex.props(styles.value)}>{description}</div>
          </div>
        )}
        {(model || provider) && (
          <div {...stylex.props(styles.field)}>
            <div {...stylex.props(styles.label)}>Model</div>
            <div {...stylex.props(styles.value)}>
              {provider && `${provider}/`}
              {model}
            </div>
          </div>
        )}
        {plugins && plugins.length > 0 && (
          <div {...stylex.props(styles.field)}>
            <div {...stylex.props(styles.label)}>Plugins</div>
            <Flexbox horizontal gap={4} wrap={'wrap'}>
              {plugins.map((plugin) => (
                <Tag key={plugin}>{plugin}</Tag>
              ))}
            </Flexbox>
          </div>
        )}
        {systemRole && (
          <div {...stylex.props(styles.field)}>
            <div {...stylex.props(styles.label)}>System Prompt</div>
            <Block paddingBlock={8} paddingInline={12} variant={'outlined'} width="100%">
              <Markdown fontSize={13} variant={'chat'}>
                {systemRole}
              </Markdown>
            </Block>
          </div>
        )}
      </div>
    );
  },
);

CreateAgentRender.displayName = 'CreateAgentRender';

export default CreateAgentRender;
