'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { NotebookText } from 'lucide-react';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import StreamingMarkdown from '@/components/StreamingMarkdown';

import type { CreateDocumentArgs } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  icon: css`
    color: ${cssVar.colorPrimary};
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

export const CreateDocumentStreaming = memo<BuiltinStreamingProps<CreateDocumentArgs>>(
  ({ args }) => {
    const { content, title } = args || {};

    if (!content && !title) return null;

    return (
      <Flexbox className={styles.container}>
        {/* Header */}
        <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
          <NotebookText className={styles.icon} size={16} />
          <Flexbox flex={1}>
            <div className={styles.title}>{title}</div>
          </Flexbox>
          <NeuralNetworkLoading size={20} />
        </Flexbox>
        {/* Content */}
        {!content ? (
          <Flexbox paddingBlock={16} paddingInline={12}>
            <BubblesLoading />
          </Flexbox>
        ) : (
          <StreamingMarkdown>{content}</StreamingMarkdown>
        )}
      </Flexbox>
    );
  },
);

CreateDocumentStreaming.displayName = 'CreateDocumentStreaming';

export default CreateDocumentStreaming;
