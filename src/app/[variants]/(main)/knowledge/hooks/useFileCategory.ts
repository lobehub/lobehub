import { useSearchParams } from 'react-router-dom';

import { FilesTabs } from '@/types/files';

/**
 * Hook to manage file category filter in URL search params
 * Uses react-router-dom instead of nuqs for MemoryRouter compatibility
 */
export const useFileCategory = (): [string, (value: string) => void] => {
  const [searchParams, setSearchParams] = useSearchParams();

  const category = searchParams.get('category') ?? FilesTabs.All;

  const setCategory = (value: string) => {
    setSearchParams(
      (prev) => {
        const newParams = new URLSearchParams(prev);

        if (value === FilesTabs.All) {
          // Clear on default
          newParams.delete('category');
        } else {
          newParams.set('category', value);
        }

        return newParams;
      },
      { replace: true },
    );
  };

  return [category, setCategory];
};
