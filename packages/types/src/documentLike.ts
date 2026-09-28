export interface DocumentLikeUser {
  avatar: string | null;
  fullName: string | null;
  id: string;
  username: string | null;
}

export interface DocumentLikeSummary {
  /** Whether the current user has liked the document. */
  liked: boolean;
  /** Most recent likers, newest first; capped server-side. */
  likers: DocumentLikeUser[];
  total: number;
}
