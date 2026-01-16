import { useNavigate } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import { usePageStore } from '@/store/page';

const DataSync = () => {
  const usePageStoreUpdater = createStoreUpdater(usePageStore);

  const navigate = useNavigate();
  usePageStoreUpdater('navigate', navigate);

  return null;
};

export default DataSync;
