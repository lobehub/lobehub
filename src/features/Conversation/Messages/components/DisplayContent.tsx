import { deserializeParts } from '@lobechat/utils';
import { type MarkdownProps } from '@lobehub/ui';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import { LOADING_FLAT } from '@/const/message';
import MarkdownMessage from '@/features/Conversation/Markdown';

import { normalizeThinkTags, processWithArtifact } from '../../utils/markdown';
import { RichContentRenderer } from './RichContentRenderer';

const DisplayContent = memo<{
  addIdOnDOM?: boolean;
  content: string;
  hasImages?: boolean;
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
  }) => {
    const message = normalizeThinkTags(processWithArtifact(content));
    if (isToolCallGenerating) return;

    if ((!content && !hasImages) || content === LOADING_FLAT) return <BubblesLoading />;

    const contentParts = isMultimodal ? deserializeParts(tempDisplayContent || content) : null;

    return contentParts ? (
      <RichContentRenderer parts={contentParts} />
    ) : (
      <MarkdownMessage {...markdownProps}>{message}</MarkdownMessage>
    );
  },
);

export default DisplayContent;
