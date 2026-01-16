import { usePathname } from '@/libs/router/navigation';

/**
 * Returns true if the current path has a sub slug (`/chat/mobile` or `/chat/settings`)
 * React Router version for SPA
 */
export const useIsSubSlug = () => {
  const pathname = usePathname();

  const slugs = pathname.split('/').filter(Boolean);

  return slugs.length > 1;
};
