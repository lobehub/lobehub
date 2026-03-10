'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Avatar, Block, Flexbox, Markdown } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import ToolTag from '@/features/ToolTag';

import type { BatchCreateAgentsParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    line-height: 1.5;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
  `,
  index: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  item: css`
    padding-block: 10px;
    padding-inline: 12px;

    &:not(:last-child) {
      border-block-end: 1px dashed ${cssVar.colorBorderSecondary};
    }
  `,
  systemRole: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
  `,
  title: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export const BatchCreateAgentsStreaming = memo<BuiltinStreamingProps<BatchCreateAgentsParams>>(
  ({ args }) => {
    const { agents } = args || {};

    if (!agents || agents.length === 0) return null;

    return (
      <Block variant={'outlined'} width="100%">
        {agents.map((agent, index) => (
          <Flexbox horizontal align={'flex-start'} className={styles.item} gap={8} key={index}>
            <div className={styles.index}>{index + 1}.</div>
            <Avatar
              avatar={agent.avatar}
              size={24}
              style={{ flexShrink: 0, marginTop: 4 }}
              title={agent.title}
            />
            <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
              <span className={styles.title}>{agent.title}</span>
              {agent.description && <span className={styles.description}>{agent.description}</span>}
              {agent.tools && agent.tools.length > 0 && (
                <Flexbox horizontal gap={4} style={{ marginTop: 8 }} wrap={'wrap'}>
                  {agent.tools.map((tool) => (
                    <ToolTag identifier={tool} key={tool} />
                  ))}
                </Flexbox>
              )}
              <Divider />
              {agent.systemRole && (
                <div className={styles.systemRole}>
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
