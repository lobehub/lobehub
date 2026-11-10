import { type MarkdownProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';
import { MENTION_TAG } from '@/const/plugin';
import { createRemarkSelfClosingTagPlugin } from '@/features/Conversation/Markdown/plugins/remarkPlugins/createRemarkSelfClosingTagPlugin';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { resolveCommentMentionName } from './commentMentionName';

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
  const memberProfiles = useWorkspaceMemberProfiles();
  const currentUser = useUserStore(userProfileSelectors.userProfile);

  const displayName = resolveCommentMentionName({ currentUser, id, memberProfiles, name });
  if (!displayName) return null;

  const { className, style } = stylex.props(styles.mention);
  return (
    <span className={`editor_mention ${className ?? ''}`} style={style}>
      @{displayName}
    </span>
  );
});

CommentMention.displayName = 'TaskCommentMention';

export const commentMarkdownProps = {
  components: { [MENTION_TAG]: CommentMention },
  // Inline code stays literal, matching the server: a quoted tag is not a mention.
  remarkPlugins: [createRemarkSelfClosingTagPlugin(MENTION_TAG, { inlineCode: false })],
} satisfies Partial<MarkdownProps>;
