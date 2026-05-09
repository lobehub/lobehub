import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import MarkdownMessage from '@/features/Conversation/Markdown';
import ContentLoading from '@/features/Conversation/Messages/components/ContentLoading';

import { dataSelectors, useConversationStore } from '../../../store';
import { normalizeThinkTags, processWithArtifact } from '../../../utils/markdown';
import { useMarkdown } from '../useMarkdown';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    pWithTool: css`
      color: ${cssVar.colorTextTertiary};
    `,
  };
});
interface MessageContentProps {
  contentOverride?: string;
  disableStreaming?: boolean;
  hasToolsOverride?: boolean;
  id: string;
}

const MessageContent = memo<MessageContentProps>(
  ({ contentOverride, disableStreaming, hasToolsOverride, id }) => {
    // Subscribe to this block's content + hasTools directly so streaming chunks
    // do not need to flow through ContentBlock's prop chain to reach us.
    const storeContent = useConversationStore(dataSelectors.getBlockContent(id));
    const storeHasTools = useConversationStore(dataSelectors.getBlockHasTools(id));
    const content = contentOverride ?? storeContent;
    const hasTools = hasToolsOverride ?? storeHasTools;

    const message = normalizeThinkTags(processWithArtifact(content ?? ''));
    const markdownProps = useMarkdown(id, disableStreaming);

    if (!content && !hasTools) return <ContentLoading id={id} />;

    if (content === LOADING_FLAT) {
      if (hasTools) return null;
      return <ContentLoading id={id} />;
    }

    const isSingleLine = (message || '').split('\n').length <= 2;
    const isToolSingleLine = hasTools && isSingleLine;

    return (
      content && (
        <MarkdownMessage {...markdownProps} className={cx(isToolSingleLine && styles.pWithTool)}>
          {message}
        </MarkdownMessage>
      )
    );
  },
);

export default MessageContent;
