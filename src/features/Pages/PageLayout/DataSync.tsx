import { createStoreUpdater } from 'zustand-utils';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePageStore } from '@/store/page';

const DataSync = () => {
  const usePageStoreUpdater = createStoreUpdater(usePageStore);

  const navigate = useWorkspaceAwareNavigate();
  usePageStoreUpdater('navigate', navigate);

  return null;
};

export default DataSync;
