import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import { LOADING_FLAT } from '@/const/message';
import MarkdownMessage from '@/features/Conversation/Markdown';

import { normalizeThinkTags, processWithArtifact } from '../../../utils/markdown';
import { useMarkdown } from '../../AssistantGroup/useMarkdown';

interface ContentBlockProps {
  content: string;
  hasTools?: boolean;
  id: string;
}

const MessageContent = memo<ContentBlockProps>(({ content, id, hasTools }) => {
  const message = normalizeThinkTags(processWithArtifact(content));
  const markdownProps = useMarkdown(id);

  if (!content || content === LOADING_FLAT) {
    if (hasTools) return null;

    return <BubblesLoading />;
  }

  return content && <MarkdownMessage {...markdownProps}>{message}</MarkdownMessage>;
});

export default MessageContent;
