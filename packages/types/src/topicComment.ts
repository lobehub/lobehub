export type TopicCommentAuthorStatus = 'active' | 'deactivated' | 'former';

export type TopicCommentJson =
  boolean | number | string | null | TopicCommentJson[] | { [key: string]: TopicCommentJson };

export interface TopicCommentAnchorPreview {
  /**
   * Server-derived excerpt of the final authored text block selected by the
   * shared assistant-group semantics, truncated to at most 200 UTF-16 code units.
   */
  excerpt: string;
  role?: string;
}

export interface TopicCommentAuthor {
  avatar: string | null;
  fullName: string | null;
  id: string | null;
  status: TopicCommentAuthorStatus;
  username: string | null;
}

export interface TopicCommentItem {
  anchorPreview: TopicCommentAnchorPreview | null;
  author: TopicCommentAuthor;
  authorUserId: string | null;
  canDelete: boolean;
  canEdit: boolean;
  canRestore: boolean;
  clientId: string;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
  editorData: TopicCommentJson | null;
  id: string;
  messageId: string | null;
  /** Recoverable Workspace Owner removal; the acting owner's identity is intentionally omitted. */
  moderatedAt: Date | null;
  moderationExpiresAt: Date | null;
  /** True only for the original author viewing their owner-removed placeholder. */
  moderationIsOwn: boolean;
  parentCommentId: string | null;
  topicId: string;
  updatedAt: Date;
  workspaceId: string;
}

export interface TopicCommentThread {
  replyCount: number;
  root: TopicCommentItem;
}
export interface TopicCommentThreadPage {
  items: TopicCommentThread[];
  nextCursor: string | null;
}
export interface TopicCommentReplyPage {
  items: TopicCommentItem[];
  nextCursor: string | null;
  /** Canonical live-reply count; returned only on the first cursor page. */
  total?: number;
}
export interface TopicCommentSummary {
  countByMessage: Record<string, number>;
  total: number;
}

export interface CreateTopicCommentInput {
  clientId: string;
  content: string;
  editorData?: TopicCommentJson;
  messageId?: string;
  parentCommentId?: string;
  topicId: string;
}

export interface UpdateTopicCommentInput {
  content?: string;
  editorData?: TopicCommentJson;
  id: string;
}
