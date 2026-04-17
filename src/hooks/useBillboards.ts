import useSWR from 'swr';

import { billboardService } from '@/services/billboard';

const KEY = 'billboards-active';

export const useBillboard = () =>
  useSWR(KEY, () => billboardService.getActive(), {
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
  });
