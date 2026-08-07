import type { TopicCommentJson } from '@lobechat/types';
import type { IEditor, ISlashMenuOption } from '@lobehub/editor';

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

export const readTopicCommentEditorValue = (editor: IEditor): TopicCommentEditorValue => ({
  content: String(editor.getDocument('markdown') ?? ''),
  editorData: (editor.getDocument('json') ?? null) as unknown as TopicCommentJson,
});

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
