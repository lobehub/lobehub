import { deserializeParts } from '@lobechat/utils';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import MarkdownMessage from '@/features/Conversation/Markdown';
import ContentLoading from '@/features/Conversation/Messages/components/ContentLoading';
import { RichContentRenderer } from '@/features/Conversation/Messages/components/RichContentRenderer';

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

    // Anchor the loading timer to this block's own createdAt (the freshest
    // message) rather than the run-start operation startTime, so an in-flight
    // block counts "time since this step began" instead of the whole run.
    const createdAt = useConversationStore((s) => {
      const value = dataSelectors.getDbMessageById(id)(s)?.createdAt;
      if (value == null) return undefined;
      const ms = new Date(value).getTime();
      return Number.isFinite(ms) ? ms : undefined;
    });
    /**
     * Image-output models (e.g. Nano Banana) persist content as serialized parts.
     * A step block after a tool call still needs to render them as images, not raw JSON.
     */
    const isMultimodal = useConversationStore(
      (s) => !!dataSelectors.getDbMessageById(id)(s)?.metadata?.isMultimodal,
    );
    const tempDisplayContent = useConversationStore(
      (s) => dataSelectors.getDbMessageById(id)(s)?.metadata?.tempDisplayContent,
    );

    const message = normalizeThinkTags(processWithArtifact(content ?? ''));
    // Once a tool call exists below this block's text, the text is already
    // finalized — skip the streaming/fade-in animation so settled content above
    // a tool doesn't keep re-animating.
    const { drawer, markdownProps } = useMarkdown(id, disableStreaming || hasTools);

    if (!content && !hasTools) return <ContentLoading id={id} startTime={createdAt} />;

    if (content === LOADING_FLAT) {
      if (hasTools) return null;
      return <ContentLoading id={id} startTime={createdAt} />;
    }

    const contentParts = isMultimodal ? deserializeParts(tempDisplayContent || content) : null;
    if (contentParts) return <RichContentRenderer parts={contentParts} />;

    const isSingleLine = (message || '').split('\n').length <= 2;
    const isToolSingleLine = hasTools && isSingleLine;

    return (
      content && (
        <>
          {drawer}
          <MarkdownMessage {...markdownProps} className={cx(isToolSingleLine && styles.pWithTool)}>
            {message}
          </MarkdownMessage>
        </>
      )
    );
  },
);

export default MessageContent;
