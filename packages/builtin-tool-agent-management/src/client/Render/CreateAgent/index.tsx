'use client';

import { SESSION_CHAT_URL } from '@lobechat/const';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Avatar, Block, Flexbox, Markdown, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowRight } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import type { CreateAgentParams, CreateAgentState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentCard: css`
    cursor: pointer;

    padding-block: 10px;
    padding-inline: 12px;
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  agentDescription: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  agentTitle: css`
    font-size: 13px;
    font-weight: 500;
  `,
  arrowIcon: css`
    color: ${cssVar.colorTextTertiary};
  `,
  container: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
  field: css`
    margin-block-end: 8px;

    &:last-child {
      margin-block-end: 0;
    }
  `,
  label: css`
    margin-block-end: 4px;
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  value: css`
    font-size: 13px;
  `,
}));

export const CreateAgentRender = memo<BuiltinRenderProps<CreateAgentParams, CreateAgentState>>(
  ({ args, pluginState }) => {
    const navigate = useNavigate();
    const { title, description, systemRole, plugins, model, provider, avatar, backgroundColor } =
      args || {};

    const handleNavigateToSession = useCallback(() => {
      const targetId = pluginState?.sessionId ?? pluginState?.agentId;
      if (!targetId) return;
      navigate(SESSION_CHAT_URL(targetId));
    }, [navigate, pluginState?.sessionId, pluginState?.agentId]);

    // After tool execution succeeds, render a clickable agent card
    if (pluginState?.success && (pluginState.agentId || pluginState.sessionId)) {
      return (
        <Flexbox
          align={'center'}
          className={styles.agentCard}
          horizontal
          gap={12}
          onClick={handleNavigateToSession}
        >
          <Avatar
            avatar={avatar || '🤖'}
            background={backgroundColor}
            shape={'square'}
            size={36}
            title={title || undefined}
          />
          <Flexbox flex={1} gap={2}>
            <span className={styles.agentTitle}>{title}</span>
            {description && <span className={styles.agentDescription}>{description}</span>}
          </Flexbox>
          <ArrowRight className={styles.arrowIcon} size={16} />
        </Flexbox>
      );
    }

    // While tool is still executing (no pluginState yet), show args preview
    if (!title && !description && !systemRole && !plugins?.length) return null;

    return (
      <div className={styles.container}>
        {title && (
          <div className={styles.field}>
            <div className={styles.label}>Title</div>
            <div className={styles.value}>{title}</div>
          </div>
        )}
        {description && (
          <div className={styles.field}>
            <div className={styles.label}>Description</div>
            <div className={styles.value}>{description}</div>
          </div>
        )}
        {(model || provider) && (
          <div className={styles.field}>
            <div className={styles.label}>Model</div>
            <div className={styles.value}>
              {provider && `${provider}/`}
              {model}
            </div>
          </div>
        )}
        {plugins && plugins.length > 0 && (
          <div className={styles.field}>
            <div className={styles.label}>Plugins</div>
            <Flexbox horizontal gap={4} wrap={'wrap'}>
              {plugins.map((plugin) => (
                <Tag key={plugin}>{plugin}</Tag>
              ))}
            </Flexbox>
          </div>
        )}
        {systemRole && (
          <div className={styles.field}>
            <div className={styles.label}>System Prompt</div>
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
