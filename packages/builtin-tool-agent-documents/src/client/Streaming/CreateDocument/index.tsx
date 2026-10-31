'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Flexbox, Spin } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileTextIcon } from 'lucide-react';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import StreamingMarkdown from '@/components/StreamingMarkdown';

import type { CreateDocumentArgs } from '../../../types';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    background: cssVar.colorBgContainer,
  },
  header: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  icon: { color: cssVar.colorPrimary },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

export const CreateDocumentStreaming = memo<BuiltinStreamingProps<CreateDocumentArgs>>(
  ({ args }) => {
    const { content, title } = args || {};

    if (!content && !title) return null;

    return (
      <Flexbox className={stylex.props(styles.container).className}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.header).className}
          gap={8}
        >
          <FileTextIcon className={stylex.props(styles.icon).className} size={16} />
          <Flexbox flex={1}>
            <div {...stylex.props(styles.title)}>{title}</div>
          </Flexbox>
          <Spin size="middle" variant="network" />
        </Flexbox>
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

CreateDocumentStreaming.displayName = 'AgentDocumentsCreateDocumentStreaming';

export default CreateDocumentStreaming;
