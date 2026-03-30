import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import MarkdownMessage from '@/features/Conversation/Markdown';
import ContentLoading from '@/features/Conversation/Messages/components/ContentLoading';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { processWithArtifact } from '../../../utils/markdown';
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
  isFirstBlock?: boolean;
}

const MessageContent = memo<ContentBlockProps>(({ content, hasTools, id, isFirstBlock }) => {
  const markdownProps = useMarkdown(id);
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));
  const message = processWithArtifact(content, generating);

  if (!content && !hasTools) return <ContentLoading id={id} />;

  if (content === LOADING_FLAT) {
    return <ContentLoading id={id} />;
  }

  const isSingleLine = (message || '').split('\n').length <= 2;
  const isToolSingleLine = hasTools && isSingleLine;

  return (
    content && (
      <MarkdownMessage
        {...markdownProps}
        animated={isFirstBlock ? false : markdownProps.animated}
        className={cx(isToolSingleLine && styles.pWithTool)}
      >
        {message}
      </MarkdownMessage>
    )
  );
});

export default MessageContent;
