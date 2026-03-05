import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import MarkdownMessage from '@/features/Conversation/Markdown';
import ContentLoading from '@/features/Conversation/Messages/components/ContentLoading';
import { messageStateSelectors, useConversationStore } from '@/features/Conversation/store';

import { normalizeThinkTags, processWithArtifact } from '../../../utils/markdown';
import { useMarkdown } from '../useMarkdown';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    pWithTool: css`
      color: ${cssVar.colorTextTertiary};
    `,
  };
});
interface ContentBlockProps {
  content: string;
  hasTools?: boolean;
  id: string;
}

const MessageContent = memo<ContentBlockProps>(({ content, hasTools, id }) => {
  const message = normalizeThinkTags(processWithArtifact(content));
  const markdownProps = useMarkdown(id);
  const isGenerating = useConversationStore(messageStateSelectors.isMessageGenerating(id));

  if (!content && !hasTools) return isGenerating ? <ContentLoading id={id} /> : null;

  if (content === LOADING_FLAT) return isGenerating ? <ContentLoading id={id} /> : null;

  const isSingleLine = (message || '').split('\n').length <= 2;

  return (
    content && (
      <MarkdownMessage
        {...markdownProps}
        className={cx(hasTools && isSingleLine && styles.pWithTool)}
      >
        {message}
      </MarkdownMessage>
    )
  );
});

export default MessageContent;
