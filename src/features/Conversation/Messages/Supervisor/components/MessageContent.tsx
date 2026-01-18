import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import MarkdownMessage from '@/features/Conversation/Markdown';

import { normalizeThinkTags, processWithArtifact } from '../../../utils/markdown';
import { useMarkdown } from '../../AssistantGroup/useMarkdown';
import ContentLoading from '../../components/ContentLoading';

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

    return <ContentLoading id={id} />;
  }

  return content && <MarkdownMessage {...markdownProps}>{message}</MarkdownMessage>;
});

export default MessageContent;
