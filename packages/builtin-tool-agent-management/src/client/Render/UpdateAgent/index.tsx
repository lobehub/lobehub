'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { UpdateAgentParams } from '../../../types';

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

export const UpdateAgentRender = memo<BuiltinRenderProps<UpdateAgentParams>>(({ args }) => {
  const { config, meta } = args || {};

  const hasConfig = config && Object.keys(config).length > 0;
  const hasMeta = meta && Object.keys(meta).length > 0;

  if (!hasConfig && !hasMeta) return null;

  return (
    <div className={styles.container}>
      {meta?.title && (
        <div className={styles.field}>
          <div className={styles.label}>Title</div>
          <div className={styles.value}>{meta.title}</div>
        </div>
      )}
      {meta?.description && (
        <div className={styles.field}>
          <div className={styles.label}>Description</div>
          <div className={styles.value}>{meta.description}</div>
        </div>
      )}
      {config?.systemRole && (
        <div className={styles.field}>
          <div className={styles.label}>System Prompt</div>
          <Block paddingBlock={8} paddingInline={12} variant={'outlined'} width="100%">
            <Markdown fontSize={13} variant={'chat'}>
              {config.systemRole as string}
            </Markdown>
          </Block>
        </div>
      )}
      {config?.model && (
        <div className={styles.field}>
          <div className={styles.label}>Model</div>
          <div className={styles.value}>{config.model as string}</div>
        </div>
      )}
    </div>
  );
});

UpdateAgentRender.displayName = 'UpdateAgentRender';

export default UpdateAgentRender;
