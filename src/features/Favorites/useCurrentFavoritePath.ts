import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import { toFavoritePath } from './path';

/** The open page as a favorite link, for targets reached at more than one URL. */
export const useCurrentFavoritePath = (): string =>
  toFavoritePath(useActiveLocation().pathname, useActiveWorkspaceSlug());
