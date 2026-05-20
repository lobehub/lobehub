import { createRawModal } from '@lobehub/ui';
import { Share2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ShareMessageModal, { type ShareModalProps } from '../../../../components/ShareMessageModal';
import { createStore, Provider, useConversationStoreApi } from '../../../../store';
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
          createRawModal(
            (props: ShareModalProps) => (
              <Provider
                createStore={() => {
                  const state = storeApi.getState();
                  return createStore({
                    context: state.context,
                    hooks: state.hooks,
                    skipFetch: state.skipFetch,
                  });
                }}
              >
                <ShareMessageModal {...props} />
              </Provider>
            ),
            { message: ctx.data },
            { onCloseKey: 'onCancel', openKey: 'open' },
          );
        },
        icon: Share2,
        key: 'share',
        label: t('share'),
      };
    }, [t, ctx.role, ctx.data, storeApi]);
  },
});
