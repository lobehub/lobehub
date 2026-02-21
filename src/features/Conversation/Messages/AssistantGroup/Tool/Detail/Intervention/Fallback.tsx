import { safeParseJSON } from '@lobechat/utils';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Edit3Icon } from 'lucide-react';
import { memo, Suspense, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

import { useConversationStore } from '../../../../../store';
import Arguments from '../Arguments';
import ApprovalActions from './ApprovalActions';
import KeyValueEditor from './KeyValueEditor';
import ModeSelector from './ModeSelector';

interface FallbackInterventionProps {
  apiName: string;
  id: string;
  identifier: string;
  requestArgs: string;
  toolCallId: string;
}

const FallbackIntervention = memo<FallbackInterventionProps>(
  ({ requestArgs, id, identifier, apiName, toolCallId }) => {
    const { t } = useTranslation('chat');
    const approvalMode = useUserStore(toolInterventionSelectors.approvalMode);
    const [isEditing, setIsEditing] = useState(false);
    const updatePluginArguments = useConversationStore((s) => s.updatePluginArguments);

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

    if (isEditing)
      return (
        <Suspense fallback={<Arguments arguments={requestArgs} />}>
          <KeyValueEditor
            initialValue={safeParseJSON(requestArgs || '')}
            onCancel={handleCancel}
            onFinish={handleFinish}
          />
        </Suspense>
      );

    return (
      <Flexbox gap={12}>
        <Arguments
          arguments={requestArgs}
          actions={
            <ActionIcon
              icon={Edit3Icon}
              size={'small'}
              title={t('edit', { ns: 'common' })}
              onClick={() => {
                setIsEditing(true);
              }}
            />
          }
        />

        <Flexbox horizontal justify={'space-between'}>
          <ModeSelector />
          <ApprovalActions
            apiName={apiName}
            approvalMode={approvalMode}
            identifier={identifier}
            messageId={id}
            toolCallId={toolCallId}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

export default FallbackIntervention;
