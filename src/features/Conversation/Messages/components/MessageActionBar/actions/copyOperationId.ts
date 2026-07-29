import { copyToClipboard } from '@lobehub/ui';
import { App } from 'antd';
import { Hash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { getOperationFinalRootId } from '../../../../store/slices/data/workSummaries';
import { defineAction } from '../defineAction';

/**
 * Dev-tool action (visible only with Advanced Tools enabled): copies the root
 * operation id of the turn that produced this message, for tracing/debugging.
 *
 * Resolution order: the durable server stamp persisted on the block/message
 * (`metadata.work.rootOperationId`, survives reloads) → the live runtime
 * operation chain, preferring the gateway's server operation id over the local
 * client-generated one. Absent when neither source knows the message.
 */
export const copyOperationIdAction = defineAction({
  key: 'copyOperationId',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const { message } = App.useApp();
    const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

    // For group messages the operation is associated with the underlying
    // assistant message (the content block), not the aggregate group id.
    const runtimeOperationId = useChatStore((s) => {
      const localOpId =
        (ctx.contentBlock && s.messageOperationMap[ctx.contentBlock.id]) ||
        s.messageOperationMap[ctx.id];
      if (!localOpId) return;
      const rootOp =
        operationSelectors.findRootRuntimeOperation(localOpId)(s) ?? s.operations[localOpId];
      if (!rootOp) return;
      return rootOp.metadata.serverOperationId ?? rootOp.id;
    });

    const durableOperationId =
      getOperationFinalRootId(ctx.contentBlock?.metadata) ??
      getOperationFinalRootId(ctx.data.metadata);
    const operationId = durableOperationId ?? runtimeOperationId;

    return useMemo(() => {
      if (!isDevMode || !operationId) return null;
      return {
        handleClick: async () => {
          await copyToClipboard(operationId);
          message.success(t('copySuccess', { ns: 'common' }));
        },
        icon: Hash,
        key: 'copyOperationId',
        label: t('messageAction.copyOperationId'),
      };
    }, [t, message, isDevMode, operationId]);
  },
});
