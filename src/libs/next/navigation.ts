/**
 * Navigation utilities wrapper for Next.js navigation APIs.
 * This module provides a unified interface that can be easily replaced
 * with react-router-dom in the future.
 *
 * @see Phase 3.1
 */

// Re-export all navigation hooks and utilities from Next.js
export {
  notFound,
  ReadonlyURLSearchParams,
  redirect,
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
  useServerInsertedHTML,
} from 'next/navigation';

// Re-export types
export type { RedirectType } from 'next/navigation';
