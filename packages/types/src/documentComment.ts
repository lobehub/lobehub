export type DocumentCommentAuthorStatus = 'active' | 'deactivated' | 'former';

export type DocumentCommentJson =
  boolean | number | string | null | DocumentCommentJson[] | { [key: string]: DocumentCommentJson };

export interface DocumentCommentAuthor {
  avatar: string | null;
  fullName: string | null;
  id: string | null;
  status: DocumentCommentAuthorStatus;
  username: string | null;
}

export interface DocumentCommentItem {
  author: DocumentCommentAuthor;
  authorUserId: string | null;
  canDelete: boolean;
  canEdit: boolean;
  clientId: string;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
  documentId: string;
  editorData: DocumentCommentJson | null;
  id: string;
  parentCommentId: string | null;
  replyTo: { author: DocumentCommentAuthor; id: string } | null;
  replyToCommentId: string | null;
  updatedAt: Date;
  workspaceId: string;
}

/** One comment fetched by id; roots also carry their live reply count. */
export interface DocumentCommentDetail extends DocumentCommentItem {
  replyCount: number;
}

export interface DocumentCommentThread {
  replyCount: number;
  root: DocumentCommentItem;
}

export interface DocumentCommentThreadPage {
  items: DocumentCommentThread[];
  nextCursor: string | null;
}

export interface DocumentCommentReplyPage {
  items: DocumentCommentItem[];
  nextCursor: string | null;
  total?: number;
}

export interface DocumentCommentSummary {
  total: number;
}

export interface CreateDocumentCommentInput {
  clientId: string;
  content: string;
  documentId: string;
  editorData?: DocumentCommentJson;
  parentCommentId?: string;
}

export interface UpdateDocumentCommentInput {
  content?: string;
  editorData?: DocumentCommentJson;
  id: string;
}
