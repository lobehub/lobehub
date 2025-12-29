'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ListChecksIcon } from 'lucide-react';
import { memo } from 'react';

import type { CreatePlanParams } from '../../../types';

const MAX_CONTENT_HEIGHT = 100;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;
  `,
  content: css`
    overflow: hidden auto;

    max-height: ${MAX_CONTENT_HEIGHT}px;
    padding: 12px;
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};
  `,
  description: css`
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;
    padding-block: 4px;
  `,
  title: css`
    overflow: hidden;

    font-size: 16px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export const CreatePlanStreaming = memo<BuiltinStreamingProps<CreatePlanParams>>(({ args }) => {
  const { goal, description, context } = args || {};

  if (!goal) return null;

  return (
    <Flexbox className={styles.container} gap={8}>
      {/* Header */}
      <div className={styles.header}>
        <Icon icon={ListChecksIcon} size={18} />
        <Text className={styles.title} ellipsis>
          {goal}
        </Text>
      </div>

      {/* Description */}
      {description && (
        <Text className={styles.description} ellipsis={{ rows: 2 }}>
          {description}
        </Text>
      )}

      {/* Context content - streaming with animation */}
      {context && (
        <div className={styles.content}>
          <Markdown animated fontSize={13} variant={'chat'}>
            {context}
          </Markdown>
        </div>
      )}
    </Flexbox>
  );
});

CreatePlanStreaming.displayName = 'CreatePlanStreaming';

export default CreatePlanStreaming;
