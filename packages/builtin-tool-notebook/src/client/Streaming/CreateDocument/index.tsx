'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { CreateDocumentArgs } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden auto;

    max-height: 400px;
    padding-block: 12px;
    padding-inline: 16px;
    border-radius: 8px;

    font-size: 14px;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

export const CreateDocumentStreaming = memo<BuiltinStreamingProps<CreateDocumentArgs>>(
  ({ args }) => {
    const { content, title } = args || {};

    // Don't render if no content yet
    if (!content) return null;

    return (
      <div className={styles.container}>
        {title && <h3 style={{ marginBottom: 12, marginTop: 0 }}>{title}</h3>}
        <Markdown>{content}</Markdown>
      </div>
    );
  },
);

CreateDocumentStreaming.displayName = 'CreateDocumentStreaming';

export default CreateDocumentStreaming;
