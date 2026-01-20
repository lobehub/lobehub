import { deserializeParts } from '@lobechat/utils';
import { type MarkdownProps } from '@lobehub/ui';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import MarkdownMessage from '@/features/Conversation/Markdown';

import { normalizeThinkTags, processWithArtifact } from '../../utils/markdown';
import ContentLoading from './ContentLoading';
import { RichContentRenderer } from './RichContentRenderer';

const DisplayContent = memo<{
  addIdOnDOM?: boolean;
  content: string;
  hasImages?: boolean;
  id: string;
  isMultimodal?: boolean;
  isToolCallGenerating?: boolean;
  markdownProps?: Omit<MarkdownProps, 'className' | 'style' | 'children'>;
  tempDisplayContent?: string;
}>(
  ({
    markdownProps,
    content,
    isToolCallGenerating,
    hasImages,
    isMultimodal,
    tempDisplayContent,
    id,
  }) => {
    const message = normalizeThinkTags(processWithArtifact(content));
    if (isToolCallGenerating) return;

    if ((!content && !hasImages) || content === LOADING_FLAT) return <ContentLoading id={id} />;

    const contentParts = isMultimodal ? deserializeParts(tempDisplayContent || content) : null;

    return contentParts ? (
      <RichContentRenderer parts={contentParts} />
    ) : (
      <MarkdownMessage {...markdownProps}>{message}</MarkdownMessage>
    );
  },
);

export default DisplayContent;
