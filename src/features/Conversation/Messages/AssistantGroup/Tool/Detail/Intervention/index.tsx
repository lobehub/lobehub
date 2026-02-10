import { safeParseJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo, Suspense, useCallback, useMemo, useRef, useState } from 'react';

import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';
import { getBuiltinIntervention } from '@/tools/interventions';

import { useConversationStore } from '../../../../../store';
import Arguments from '../Arguments';
import ApprovalActions from './ApprovalActions';
import Fallback from './Fallback';
import KeyValueEditor from './KeyValueEditor';
import ModeSelector from './ModeSelector';
import SecurityBlacklistWarning from './SecurityBlacklistWarning';

export type ApprovalMode = 'auto-run' | 'allow-list' | 'manual';

interface InterventionProps {
  apiName: string;
  id: string;
  identifier: string;
  requestArgs: string;
  toolCallId: string;
}

const Intervention = memo<InterventionProps>(
  ({ requestArgs, id, identifier, apiName, toolCallId }) => {
    const approvalMode = useUserStore(toolInterventionSelectors.approvalMode);
    const [isEditing, setIsEditing] = useState(false);
    const updatePluginArguments = useConversationStore((s) => s.updatePluginArguments);

    // Store beforeApprove callbacks from intervention components (support multiple registrations)
    // Use Map with id as key for reliable cleanup
    const beforeApproveCallbacksRef = useRef<Map<string, () => void | Promise<void>>>(new Map());

    // Register a callback to be called before approval
    const registerBeforeApprove = useCallback(
      (callbackId: string, callback: () => void | Promise<void>) => {
        beforeApproveCallbacksRef.current.set(callbackId, callback);
        // Return cleanup function to unregister
        return () => {
          beforeApproveCallbacksRef.current.delete(callbackId);
        };
      },
      [],
    );

    // Handler to be called before approve action - calls all registered callbacks
    const handleBeforeApprove = useCallback(async () => {
      const callbacks = Array.from(beforeApproveCallbacksRef.current.values());
      await Promise.all(callbacks.map((cb) => cb()));
    }, []);

    const handleCancel = useCallback(() => {
      setIsEditing(false);
    }, []);

    const handleFinish = useCallback(
      async (editedObject: Record<string, any>) => {
        if (!toolCallId) return;

        try {
          const newArgsString = JSON.stringify(editedObject, null, 2);

          if (newArgsString !== requestArgs) {
            await updatePluginArguments(toolCallId, editedObject, true);
          }
          setIsEditing(false);
        } catch (error) {
          console.error('Error stringifying arguments:', error);
        }
      },
      [requestArgs, toolCallId, updatePluginArguments],
    );

    // Callback for builtin intervention components to update arguments
    const handleArgsChange = useCallback(
      async (newArgs: unknown) => {
        if (!toolCallId) return;
        await updatePluginArguments(toolCallId, newArgs, true);
      },
      [toolCallId, updatePluginArguments],
    );

    const parsedArgs = useMemo(() => safeParseJSON(requestArgs || '') ?? {}, [requestArgs]);

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

      return (
        <Flexbox gap={12}>
          <SecurityBlacklistWarning args={parsedArgs} />
          <BuiltinToolInterventionRender
            apiName={apiName}
            args={parsedArgs}
            identifier={identifier}
            messageId={id}
            registerBeforeApprove={registerBeforeApprove}
            onArgsChange={handleArgsChange}
          />
          <Flexbox horizontal justify={'space-between'}>
            <ModeSelector />
            <ApprovalActions
              apiName={apiName}
              approvalMode={approvalMode}
              identifier={identifier}
              messageId={id}
              toolCallId={toolCallId}
              onBeforeApprove={handleBeforeApprove}
            />
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={12}>
        <SecurityBlacklistWarning args={parsedArgs} />
        <Fallback
          apiName={apiName}
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
