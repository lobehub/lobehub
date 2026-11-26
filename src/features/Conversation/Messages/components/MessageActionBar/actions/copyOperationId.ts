import { copyToClipboard, toast } from '@lobehub/ui';
import { Hash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { defineAction } from '../defineAction';

/**
 * Copies the id of the operation that produced this message, for tracing and
 * bug reports. Normal menus keep it under Advanced; error menus list it flat,
 * since a failed run is exactly what someone reports.
 *
 * Resolution order: the creation-provenance stamp persisted on the
 * block/message (`metadata.operationId`, survives reloads) → the live runtime
 * operation chain, preferring the gateway's server operation id over the local
 * client-generated one. Absent when neither source knows the message.
 */
const getStampedOperationId = (metadata?: { operationId?: unknown } | null) =>
  typeof metadata?.operationId === 'string' ? metadata.operationId : undefined;

export const copyOperationIdAction = defineAction({
  key: 'copyOperationId',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    // For group messages the operation is associated with the underlying
    // assistant message (the content block), not the aggregate group id.
    const runtimeOperationId = useChatStore((s) => {
      const localOpId =
        (ctx.contentBlock && s.messageOperationMap[ctx.contentBlock.id]) ||
        s.messageOperationMap[ctx.id];
      if (!localOpId) return;
      // Only accept an AI-runtime ancestor: messageOperationMap is
      // last-write-wins, so per-message utility operations (translate, …)
      // can own the slot — their ids are not what this action traces.
      const rootOp = operationSelectors.findRootRuntimeOperation(localOpId)(s);
      if (!rootOp) return;
      return rootOp.metadata.serverOperationId ?? rootOp.id;
    });

    const durableOperationId =
      getStampedOperationId(ctx.contentBlock?.metadata) ?? getStampedOperationId(ctx.data.metadata);
    const operationId = durableOperationId ?? runtimeOperationId;

    return useMemo(() => {
      if (!operationId) return null;
      return {
        handleClick: async () => {
          await copyToClipboard(operationId);
          toast.success(t('copySuccess', { ns: 'common' }));
        },
        icon: Hash,
        key: 'copyOperationId',
        label: t('messageAction.copyOperationId'),
      };
    }, [t, operationId]);
  },
});
