import { standardizeIdentifier } from '@/utils/identifier';

/**
 * Build the public route for a Page document.
 *
 * Page list data carries the database identifier (`docs_<id>`), while the
 * `/page/:id` route exposes the bare identifier. Agent document routes keep
 * their own navigation helper because they have different route semantics.
 */
export const buildPagePath = (documentId: string): string =>
  `/page/${standardizeIdentifier(documentId)}`;
