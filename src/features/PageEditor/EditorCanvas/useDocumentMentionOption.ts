import type { EditorProps } from '@lobehub/editor/react';

import { useWorkspaceCommentMentionOption } from '@/features/Portal/TopicComments/useWorkspaceCommentMentionOption';

import { usePageEditorStore } from '../store';

/**
 * `@member` source for the document body. Reuses the comment mention source so
 * a member chip serialises identically (`metadata.type === 'member'`) whether
 * it lives in the page or in a comment, and the server extracts both with the
 * same walker.
 *
 * Enabled on every workspace page, private drafts included — a page created
 * from the sidebar starts as 私人, so that is where most `@` typing happens.
 * A personal page (no workspace) has no one to name, so the trigger stays off
 * there instead of opening an empty menu. Not gated on editability: a
 * read-only editor cannot type `@` anyway, and keeping the option stable
 * avoids re-registering the mention plugin mid-session.
 */
export const useDocumentMentionOption = (): EditorProps['mentionOption'] | undefined => {
  const isWorkspaceScopedPage = usePageEditorStore((s) => s.isWorkspaceScopedPage);
  const mentionOption = useWorkspaceCommentMentionOption();

  return isWorkspaceScopedPage ? mentionOption : undefined;
};
