'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Block, Flexbox, Markdown, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { CreateAgentParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  label: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  value: css`
    font-size: 13px;
  `,
}));

export const CreateAgentStreaming = memo<BuiltinStreamingProps<CreateAgentParams>>(({ args }) => {
  const { title, description, systemRole, plugins, model, provider } = args || {};

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
          <Flexbox gap={4} horizontal wrap={'wrap'}>
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
            <Markdown animated variant={'chat'}>
              {systemRole}
            </Markdown>
          </Block>
        </div>
      )}
    </div>
  );
});

CreateAgentStreaming.displayName = 'CreateAgentStreaming';

export default CreateAgentStreaming;
