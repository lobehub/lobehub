import qs from 'query-string';
import { useMemo } from 'react';

import { useSearchParams } from '@/libs/router/navigation';

/**
 * Hook to get query parameters
 * React Router version for SPA
 */
export const useQuery = () => {
  const [searchParams] = useSearchParams();
  return useMemo(() => qs.parse(searchParams.toString()), [searchParams]);
};
