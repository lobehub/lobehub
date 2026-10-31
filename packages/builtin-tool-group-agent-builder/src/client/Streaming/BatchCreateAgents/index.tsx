'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Avatar, Block, Divider, Flexbox, Markdown } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import ToolTag from '@/features/ToolTag';

import type { BatchCreateAgentsParams } from '../../../types';

const styles = stylex.create({
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    lineHeight: 1.5,
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
  },
  index: { flexShrink: 0, fontSize: '12px', color: cssVar.colorTextQuaternary },
  item: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'dashed' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  systemRole: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
  },
  title: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export const BatchCreateAgentsStreaming = memo<BuiltinStreamingProps<BatchCreateAgentsParams>>(
  ({ args }) => {
    const { agents } = args || {};

    if (!agents || agents.length === 0) return null;

    return (
      <Block variant={'outlined'} width="100%">
        {agents.map((agent, index) => (
          <Flexbox
            horizontal
            align={'flex-start'}
            className={stylex.props(styles.item).className}
            gap={8}
            key={index}
          >
            <div {...stylex.props(styles.index)}>{index + 1}.</div>
            <Avatar
              avatar={agent.avatar}
              size={24}
              style={{ flexShrink: 0, marginTop: 4 }}
              title={agent.title}
            />
            <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
              <span {...stylex.props(styles.title)}>{agent.title}</span>
              {agent.description && (
                <span {...stylex.props(styles.description)}>{agent.description}</span>
              )}
              {agent.tools && agent.tools.length > 0 && (
                <Flexbox horizontal gap={4} style={{ marginTop: 8 }} wrap={'wrap'}>
                  {agent.tools.map((tool) => (
                    <ToolTag identifier={tool} key={tool} />
                  ))}
                </Flexbox>
              )}
              <Divider style={{ marginBlock: 24 }} />
              {agent.systemRole && (
                <div {...stylex.props(styles.systemRole)}>
                  <Markdown animated variant={'chat'}>
                    {agent.systemRole}
                  </Markdown>
                </div>
              )}
            </Flexbox>
          </Flexbox>
        ))}
      </Block>
    );
  },
);

BatchCreateAgentsStreaming.displayName = 'BatchCreateAgentsStreaming';

export default BatchCreateAgentsStreaming;
