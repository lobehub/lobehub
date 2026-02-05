import { devtools } from 'zustand/middleware';

import { isDev } from '@/utils/env';

export const chatGroupDevtools = (name: string) =>
  devtools<any, any, any, any>(
    (store) =>
      (...a: Parameters<typeof store>) => {
        const res = store(...a);

        if (isDev && res && typeof res === 'object' && 'internal_dispatchChatGroup' in res) {
          // @ts-ignore
          window.dispatchChatGroup = res.internal_dispatchChatGroup;
        }
        return res;
      },
    { name: `LOBE_CHAT_CHAT_GROUP_STORE_${name}` },
  );
