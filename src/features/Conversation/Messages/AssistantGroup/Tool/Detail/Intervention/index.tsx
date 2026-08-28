import { getBuiltinIntervention } from '@lobechat/builtin-tools/interventions';
import { safeParseJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useSingleton } from '@/hooks/useSingleton';
import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

import { useConversationResourceAccess } from '../../../../../hooks/useConversationResourceAccess';
import { dataSelectors, useConversationStore } from '../../../../../store';
import Arguments from '../Arguments';
import ApprovalActions from './ApprovalActions';
import {
  isAgentMarketplaceCall,
  isCustomInteractionIdentifier,
  isHeteroInteractionIdentifier,
  prepareCustomInteractionSubmit,
  recordCustomInteractionResolution,
} from './customInteractionHandlers';
import Fallback from './Fallback';
import KeyValueEditor from './KeyValueEditor';
import SecurityBlacklistWarning from './SecurityBlacklistWarning';

export type { ApprovalMode } from '@/store/user/slices/settings/selectors';

interface InterventionProps {
  actionsPortalTarget?: HTMLDivElement | null;
  apiName: string;
  assistantGroupId?: string;
  id: string;
  identifier: string;
  requestArgs: string;
  toolCallId: string;
}

const Intervention = memo<InterventionProps>(
  ({ requestArgs, id, identifier, apiName, toolCallId, assistantGroupId, actionsPortalTarget }) => {
    const approvalMode = useUserStore(toolInterventionSelectors.approvalMode);
    const { canUseResource } = useConversationResourceAccess();
    const [isEditing, setIsEditing] = useState(false);
    const updatePluginArguments = useConversationStore((s) => s.updatePluginArguments);
    const message = useConversationStore((s) => dataSelectors.getDbMessageById(id)(s));
    const usesDurableServerClaim = Boolean(
      message?.pluginIntervention?.operationId && message.pluginIntervention.batchId,
    );
    const [pendingEditedArguments, setPendingEditedArguments] = useState<
      Record<string, unknown> | undefined
    >();
    const pendingEditedArgumentsRef = useRef<Record<string, unknown> | undefined>(undefined);

    const beforeApproveCallbacks = useSingleton(
      () => new Map<string, () => void | Promise<void>>(),
    );

    const registerBeforeApprove = useCallback(
      (callbackId: string, callback: () => void | Promise<void>) => {
        beforeApproveCallbacks.set(callbackId, callback);
        return () => {
          beforeApproveCallbacks.delete(callbackId);
        };
      },
      [beforeApproveCallbacks],
    );

    const handleBeforeApprove = useCallback(async () => {
      const callbacks = Array.from(beforeApproveCallbacks.values());
      await Promise.all(callbacks.map((cb) => cb()));
      return usesDurableServerClaim ? pendingEditedArgumentsRef.current : undefined;
    }, [beforeApproveCallbacks, usesDurableServerClaim]);

    const handleCancel = useCallback(() => {
      setIsEditing(false);
    }, []);

    const handleFinish = useCallback(
      async (editedObject: Record<string, any>) => {
        if (!toolCallId) return;

        try {
          const newArgsString = JSON.stringify(editedObject, null, 2);

          if (newArgsString !== requestArgs) {
            if (usesDurableServerClaim) {
              pendingEditedArgumentsRef.current = editedObject;
              setPendingEditedArguments(editedObject);
            } else {
              await updatePluginArguments(toolCallId, editedObject, true);
            }
          }
          setIsEditing(false);
        } catch (error) {
          console.error('Error stringifying arguments:', error);
        }
      },
      [requestArgs, toolCallId, updatePluginArguments, usesDurableServerClaim],
    );

    // Callback for builtin intervention components to update arguments
    const handleArgsChange = useCallback(
      async (newArgs: unknown) => {
        if (!toolCallId || !canUseResource) return;
        if (usesDurableServerClaim && newArgs && typeof newArgs === 'object') {
          const editedArguments = newArgs as Record<string, unknown>;
          pendingEditedArgumentsRef.current = editedArguments;
          setPendingEditedArguments(editedArguments);
          return;
        }
        await updatePluginArguments(toolCallId, newArgs, true);
      },
      [canUseResource, toolCallId, updatePluginArguments, usesDurableServerClaim],
    );

    const parsedArgs = useMemo(
      () => pendingEditedArguments ?? safeParseJSON(requestArgs || '') ?? {},
      [pendingEditedArguments, requestArgs],
    );

    const isCustomInteraction = isCustomInteractionIdentifier(identifier, apiName);

    const topicId = message?.topicId;
    const interventionResolving = message?.pluginIntervention?.resolving === true;
    const submitToolInteraction = useConversationStore((s) => s.submitToolInteraction);
    const skipToolInteraction = useConversationStore((s) => s.skipToolInteraction);
    const cancelToolInteraction = useConversationStore((s) => s.cancelToolInteraction);
    // Hetero (CC / Codex) interventions ship the answer back through IPC to a
    // running CLI subprocess instead of starting a fresh `executeClientAgent`
    // turn. Route through the conversation store so it carries this card's own
    // `context` (agent/topic) to the chat store — otherwise the optimistic
    // writes and topic-status flip fall back to the global `activeTopicId` and
    // land on whichever topic the user is currently viewing.
    const submitHeteroIntervention = useConversationStore((s) => s.submitHeteroIntervention);

    const handleInteractionAction = useCallback(
      async (
        action:
          | { type: 'submit'; payload: Record<string, unknown> }
          | { type: 'skip'; payload?: Record<string, unknown>; reason?: string }
          | { type: 'cancel'; payload?: Record<string, unknown> },
      ) => {
        if (!canUseResource || interventionResolving) return;
        if (isHeteroInteractionIdentifier(identifier)) {
          await submitHeteroIntervention(id, action.type, action.payload);
          return;
        }
        switch (action.type) {
          case 'submit': {
            if (usesDurableServerClaim && isAgentMarketplaceCall(identifier, apiName)) {
              const selectedTemplateIds = action.payload.selectedTemplateIds;
              if (
                Array.isArray(selectedTemplateIds) &&
                selectedTemplateIds.length > 0 &&
                selectedTemplateIds.every((templateId) => typeof templateId === 'string')
              ) {
                await submitToolInteraction(id, action.payload, {
                  agentInterventionAction: {
                    result: { kind: 'agent_marketplace', selectedTemplateIds },
                    type: 'submit_custom',
                  },
                  prepareLegacyFallback: async () => {
                    const prepared = await prepareCustomInteractionSubmit(
                      identifier,
                      action.payload,
                      { apiName, requestArgs: parsedArgs, topicId },
                    );
                    return { response: prepared.payload, ...prepared.options };
                  },
                });
                break;
              }
            }
            const { payload, options } = await prepareCustomInteractionSubmit(
              identifier,
              action.payload,
              {
                apiName,
                requestArgs: parsedArgs,
                topicId,
              },
            );
            await submitToolInteraction(id, payload, options);
            break;
          }
          case 'skip': {
            const recordSkipped = () =>
              recordCustomInteractionResolution(
                identifier,
                'skipped',
                action.payload,
                { apiName, requestArgs: parsedArgs, topicId },
                action.reason,
              );
            if (!usesDurableServerClaim) await recordSkipped();
            await skipToolInteraction(
              id,
              action.reason,
              usesDurableServerClaim ? { onLegacyFallback: recordSkipped } : undefined,
            );
            break;
          }
          case 'cancel': {
            const recordCancelled = () =>
              recordCustomInteractionResolution(identifier, 'cancelled', action.payload, {
                apiName,
                requestArgs: parsedArgs,
                topicId,
              });
            if (!usesDurableServerClaim) await recordCancelled();
            await cancelToolInteraction(
              id,
              usesDurableServerClaim ? { onLegacyFallback: recordCancelled } : undefined,
            );
            break;
          }
        }
      },
      [
        apiName,
        canUseResource,
        cancelToolInteraction,
        id,
        identifier,
        interventionResolving,
        parsedArgs,
        skipToolInteraction,
        submitHeteroIntervention,
        submitToolInteraction,
        topicId,
        usesDurableServerClaim,
      ],
    );

    const BuiltinToolInterventionRender = getBuiltinIntervention(identifier, apiName);

    if (BuiltinToolInterventionRender) {
      if (isEditing)
        return (
          <Suspense fallback={<Arguments arguments={requestArgs} />}>
            <KeyValueEditor
              initialValue={parsedArgs}
              onCancel={handleCancel}
              onFinish={handleFinish}
            />
          </Suspense>
        );

      if (isCustomInteraction) {
        return (
          <Flexbox gap={12}>
            <BuiltinToolInterventionRender
              actionsPortalTarget={actionsPortalTarget}
              apiName={apiName}
              args={parsedArgs}
              disabled={interventionResolving || !canUseResource}
              identifier={identifier}
              interactionMode="custom"
              messageId={id}
              registerBeforeApprove={registerBeforeApprove}
              onArgsChange={handleArgsChange}
              onInteractionAction={handleInteractionAction}
            />
          </Flexbox>
        );
      }

      const actions = (
        <Flexbox horizontal justify={'flex-end'}>
          <ApprovalActions
            apiName={apiName}
            approvalMode={approvalMode}
            assistantGroupId={assistantGroupId}
            identifier={identifier}
            messageId={id}
            toolCallId={toolCallId}
            onBeforeApprove={handleBeforeApprove}
          />
        </Flexbox>
      );

      return (
        <Flexbox data-pending-hotkey-scope gap={12}>
          <SecurityBlacklistWarning args={parsedArgs} />
          <BuiltinToolInterventionRender
            apiName={apiName}
            args={parsedArgs}
            identifier={identifier}
            messageId={id}
            registerBeforeApprove={registerBeforeApprove}
            onArgsChange={handleArgsChange}
          />
          {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={12}>
        <SecurityBlacklistWarning args={parsedArgs} />
        <Fallback
          actionsPortalTarget={actionsPortalTarget}
          apiName={apiName}
          assistantGroupId={assistantGroupId}
          id={id}
          identifier={identifier}
          requestArgs={requestArgs}
          toolCallId={toolCallId}
        />
      </Flexbox>
    );
  },
);

export default Intervention;
