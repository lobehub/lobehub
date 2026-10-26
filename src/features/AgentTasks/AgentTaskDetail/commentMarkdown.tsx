import { type MarkdownProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { MENTION_TAG } from '@/const/plugin';
import { createRemarkSelfClosingTagPlugin } from '@/features/Conversation/Markdown/plugins/remarkPlugins/createRemarkSelfClosingTagPlugin';

const styles = stylex.create({
  mention: {
    color: cssVar.colorInfo,
    wordBreak: 'break-word',
  },
});

interface CommentMentionProps {
  node?: { properties?: { id?: string; name?: string } };
}

/**
 * Markdown-only comments (CLI, agent tools) carry member mentions as the same
 * `<mention name="…" id="…" />` tag the comment editor serializes. Render it
 * like the rich-text mention instead of dropping it as raw HTML.
 */
const CommentMention = memo<CommentMentionProps>(({ node }) => {
  const { id, name } = node?.properties || {};
  if (!name && !id) return null;

  const { className, style } = stylex.props(styles.mention);
  return (
    <span className={`editor_mention ${className ?? ''}`} style={style}>
      @{name || id}
    </span>
  );
});

CommentMention.displayName = 'TaskCommentMention';

export const commentMarkdownProps = {
  components: { [MENTION_TAG]: CommentMention },
  // Inline code stays literal, matching the server: a quoted tag is not a mention.
  remarkPlugins: [createRemarkSelfClosingTagPlugin(MENTION_TAG, { inlineCode: false })],
} satisfies Partial<MarkdownProps>;
