/**
 * Navigation utilities — re-exports from next/navigation.
 * In Vite/SPA mode, this file is replaced by navigation.vite.ts via the
 * viteModuleRedirect plugin (see vite.config.ts).
 */

export {
  notFound,
  redirect,
  type ReadonlyURLSearchParams,
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from 'next/navigation';

export type RedirectType = 'push' | 'replace';
