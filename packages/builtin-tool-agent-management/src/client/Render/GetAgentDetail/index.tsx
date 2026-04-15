'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Avatar, Block, Flexbox, Markdown, Tag } from '@lobehub/ui';
import { createStaticStyles, useTheme } from 'antd-style';
import { memo } from 'react';

import type { GetAgentDetailParams, GetAgentDetailState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
  header: css`
    display: flex;
    gap: 12px;
    align-items: center;

    margin-block-end: 12px;
    padding-block-end: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  label: css`
    margin-block-end: 4px;
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 14px;
    font-weight: 600;
  `,
  value: css`
    font-size: 13px;
  `,
}));

export const GetAgentDetailRender = memo<
  BuiltinRenderProps<GetAgentDetailParams, GetAgentDetailState>
>(({ pluginState }) => {
  const theme = useTheme();
  const meta = pluginState?.meta;
  const config = pluginState?.config;

  if (!meta && !config) return null;

  return (
    <div className={styles.container}>
      {meta && (
        <div className={styles.header}>
          <Avatar
            avatar={meta.avatar || DEFAULT_AVATAR}
            background={meta.backgroundColor || theme.colorBgContainer}
            shape={'square'}
            size={36}
            title={meta.title || undefined}
          />
          <Flexbox gap={2}>
            <span className={styles.title}>{meta.title || 'Untitled'}</span>
            {meta.description && <span className={styles.value}>{meta.description}</span>}
          </Flexbox>
        </div>
      )}
      {(config?.model || config?.provider) && (
        <div className={styles.field}>
          <div className={styles.label}>Model</div>
          <div className={styles.value}>
            {config.provider && `${config.provider}/`}
            {config.model}
          </div>
        </div>
      )}
      {config?.plugins && config.plugins.length > 0 && (
        <div className={styles.field}>
          <div className={styles.label}>Plugins</div>
          <Flexbox horizontal gap={4} wrap={'wrap'}>
            {config.plugins.map((plugin) => (
              <Tag key={plugin}>{plugin}</Tag>
            ))}
          </Flexbox>
        </div>
      )}
      {meta?.tags && meta.tags.length > 0 && (
        <div className={styles.field}>
          <div className={styles.label}>Tags</div>
          <Flexbox horizontal gap={4} wrap={'wrap'}>
            {meta.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Flexbox>
        </div>
      )}
      {config?.systemRole && (
        <div className={styles.field}>
          <div className={styles.label}>System Prompt</div>
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
