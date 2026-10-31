'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Markdown, Tag, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';

import type { GetAgentDetailParams, GetAgentDetailState } from '../../../types';

const styles = stylex.create({
  container: { paddingBlock: '4px' },
  field: { marginBlockEnd: { 'default': '8px', ':last-child': '0' } },
  header: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    marginBlockEnd: '12px',
    paddingBlockEnd: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  label: {
    marginBlockEnd: '4px',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  title: { fontSize: '14px', fontWeight: 600 },
  value: { fontSize: '13px' },
});

export const GetAgentDetailRender = memo<
  BuiltinRenderProps<GetAgentDetailParams, GetAgentDetailState>
>(({ pluginState }) => {
  const theme = useTheme();
  const meta = pluginState?.meta;
  const config = pluginState?.config;

  if (!meta && !config) return null;

  return (
    <div {...stylex.props(styles.container)}>
      {meta && (
        <div {...stylex.props(styles.header)}>
          <AgentAvatar
            agentId={pluginState?.agentId}
            avatar={meta.avatar}
            background={meta.backgroundColor || theme.colorBgContainer}
            shape={'square'}
            size={36}
            title={meta.title || undefined}
          />
          <Flexbox gap={2}>
            <span {...stylex.props(styles.title)}>{meta.title || 'Untitled'}</span>
            {meta.description && <span {...stylex.props(styles.value)}>{meta.description}</span>}
          </Flexbox>
        </div>
      )}
      {(config?.model || config?.provider) && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Model</div>
          <div {...stylex.props(styles.value)}>
            {config.provider && `${config.provider}/`}
            {config.model}
          </div>
        </div>
      )}
      {config?.plugins && config.plugins.length > 0 && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Plugins</div>
          <Flexbox horizontal gap={4} wrap={'wrap'}>
            {config.plugins.map((plugin) => (
              <Tag key={plugin}>{plugin}</Tag>
            ))}
          </Flexbox>
        </div>
      )}
      {meta?.tags && meta.tags.length > 0 && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>Tags</div>
          <Flexbox horizontal gap={4} wrap={'wrap'}>
            {meta.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Flexbox>
        </div>
      )}
      {config?.systemRole && (
        <div {...stylex.props(styles.field)}>
          <div {...stylex.props(styles.label)}>System Prompt</div>
          <Block paddingBlock={8} paddingInline={12} variant={'outlined'} width="100%">
            <Markdown fontSize={13} variant={'chat'}>
              {config.systemRole}
            </Markdown>
          </Block>
        </div>
      )}
    </div>
  );
});

GetAgentDetailRender.displayName = 'GetAgentDetailRender';

export default GetAgentDetailRender;
