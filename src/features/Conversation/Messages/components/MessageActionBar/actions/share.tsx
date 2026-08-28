import { Share2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { openShareMessageModal } from '../../../../components/ShareMessageModal';
import { createStore, useConversationStoreApi } from '../../../../store';
import { defineAction } from '../defineAction';

export const shareAction = defineAction({
  key: 'share',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');
    const storeApi = useConversationStoreApi();

    return useMemo(() => {
      if (ctx.role === 'user') return null;
      return {
        handleClick: () => {
          openShareMessageModal(ctx.data, () => {
            const state = storeApi.getState();
            return createStore({
              context: state.context,
              hooks: state.hooks,
              skipFetch: state.skipFetch,
            });
          });
        },
        icon: Share2,
        key: 'share',
        label: t('share'),
      };
    }, [t, ctx.role, ctx.data, storeApi]);
  },
});
