import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/** The detail header can return to the same category, query and page that opened it. */
export const useCatalogDetailNavigate = () => {
  const navigate = useWorkspaceAwareNavigate();
  const { pathname, search } = useLocation();
  return (to: string) => navigate(to, { state: { marketplaceCatalog: pathname + search } });
};
