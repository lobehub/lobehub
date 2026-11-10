import useSWR from 'swr';

import { electronLocalAsrService } from '@/services/electron/localAsr';

export const LOCAL_ASR_STATUS_KEY = 'desktop-local-asr-status';

export const useLocalAsrStatus = () =>
  useSWR(LOCAL_ASR_STATUS_KEY, () => electronLocalAsrService.getStatus(), {
    revalidateOnFocus: false,
  });
