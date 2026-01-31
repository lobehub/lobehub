import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import MarkdownMessage from '@/features/Conversation/Markdown';
import ContentLoading from '@/features/Conversation/Messages/components/ContentLoading';

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

  if (!content && !hasTools) return <ContentLoading id={id} />;

  if (content === LOADING_FLAT) {
    return <ContentLoading id={id} />;
  }

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
