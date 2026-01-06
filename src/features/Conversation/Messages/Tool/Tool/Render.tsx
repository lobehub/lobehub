import { Suspense, memo } from 'react';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../../store';
import CustomRender from '../../AssistantGroup/Tool/Render/CustomRender';
import ErrorResponse from '../../AssistantGroup/Tool/Render/ErrorResponse';

interface RenderProps {
  messageId: string;
  requestArgs?: string;
  setShowPluginRender: (show: boolean) => void;
  showPluginRender: boolean;
  toolCallId: string;
  toolIndex: number;
}

const Render = memo<RenderProps>(
  ({ toolCallId, toolIndex, messageId, requestArgs, showPluginRender, setShowPluginRender }) => {
    const loading = useConversationStore(
      messageStateSelectors.isToolCallStreaming(messageId, toolIndex),
    );
    const toolMessage = useConversationStore(dataSelectors.getDbMessageByToolCallId(toolCallId));

    if (loading || !toolMessage) return null;

    if (!!toolMessage) {
      if (toolMessage.error) {
        return <ErrorResponse {...toolMessage.error} id={messageId} plugin={toolMessage.plugin} />;
      }

      return (
        <Suspense>
          <CustomRender
            {...toolMessage}
            requestArgs={requestArgs}
            setShowPluginRender={setShowPluginRender}
            showPluginRender={showPluginRender}
            toolCallId={toolCallId}
          />
        </Suspense>
      );
    }
  },
);

Render.displayName = 'ToolRender';

export default Render;
