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
    if (hasTools) return null;

    return <ContentLoading id={id} />;
  }

  return (
    content && (
      <MarkdownMessage {...markdownProps} className={cx(hasTools && styles.pWithTool)}>
        {message}
      </MarkdownMessage>
    )
  );
});

export default MessageContent;
