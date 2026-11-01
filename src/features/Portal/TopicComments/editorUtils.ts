import type { TopicCommentJson } from '@lobechat/types';
import type { IEditor, ISlashMenuOption } from '@lobehub/editor';
import { INSERT_MENTION_COMMAND } from '@lobehub/editor';
import { $getSelection, $isRangeSelection } from 'lexical';

export interface MentionableWorkspaceMember {
  user?: {
    avatar?: string | null;
    email?: string | null;
    fullName?: string | null;
    username?: string | null;
  } | null;
  userId: string;
}

export interface TopicCommentEditorValue {
  content: string;
  editorData: TopicCommentJson;
}

export const createTopicCommentMentionItems = (members: MentionableWorkspaceMember[]) => {
  const seen = new Set<string>();

  return members.flatMap((member) => {
    if (!member.userId || seen.has(member.userId)) return [];
    seen.add(member.userId);

    const profile = member.user;
    const label = profile?.fullName || profile?.username || profile?.email || member.userId;
    const description = profile?.email && profile.email !== label ? profile.email : undefined;

    return [
      {
        avatar: profile?.avatar || label,
        key: `member-${member.userId}`,
        label,
        metadata: {
          description,
          id: member.userId,
          timestamp: 0,
          type: 'member',
        },
      },
    ];
  });
};

export const writeTopicCommentMentionMarkdown = (mention: {
  label?: string;
  metadata?: Record<string, unknown>;
}) => `<mention name="${mention.label ?? ''}" id="${String(mention.metadata?.id ?? '')}" />`;

export const createTopicCommentMentionPayload = (option: ISlashMenuOption) => ({
  label: String(option.label),
  metadata: option.metadata,
});

export const insertTopicCommentMention = (editor: IEditor, option: ISlashMenuOption) => {
  editor.dispatchCommand(INSERT_MENTION_COMMAND, createTopicCommentMentionPayload(option));

  editor.getLexicalEditor()?.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    // An inline decorator at the end of a paragraph has no DOM text position for the caret.
    // Keep a trailing text node selected so typing can continue immediately after the mention.
    selection.insertText(' ');
  });
  editor.focus();
};

export const readTopicCommentEditorValue = (editor: IEditor): TopicCommentEditorValue => {
  const editorData = editor.getDocument('json') ?? null;

  return {
    content: String(editor.getDocument('markdown') ?? ''),
    // Lexical nodes can expose optional properties with an `undefined` value
    // (for example a FileNode without message/size). tRPC and PostgreSQL accept
    // JSON values only, so normalize the editor snapshot at this shared
    // boundary before comments are drafted or submitted.
    // eslint-disable-next-line unicorn/prefer-structured-clone -- structuredClone preserves undefined properties.
    editorData: JSON.parse(JSON.stringify(editorData)) as TopicCommentJson,
  };
};

export const resolveTopicCommentEditorContent = (
  initialContent: string,
  initialEditorData?: TopicCommentJson | null,
) => ({
  content: initialEditorData ?? initialContent,
  type: initialEditorData
    ? ('json' as const)
    : initialContent
      ? ('markdown' as const)
      : ('text' as const),
});
