export interface AuthorInfo {
  avatar?: string | null;
  fullName?: string | null;
}

export const useAuthorInfo = (_userId?: string): AuthorInfo | undefined => undefined;
