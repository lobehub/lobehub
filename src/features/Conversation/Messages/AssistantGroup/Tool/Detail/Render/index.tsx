import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { type ChatPluginPayload } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { useToolResultPayload } from '@/hooks/useToolResultPayload';

import { dataSelectors, useConversationStore } from '../../../../../store';
import CustomRender from './CustomRender';
import { FallbackArgumentRender } from './FallbacktArgumentRender';

interface ToolRenderProps {
  content: string;
  messageId?: string;
  plugin?: ChatPluginPayload;
  pluginState?: any;
  showCustomToolRender?: boolean;
  toolCallId: string;
}

const ToolRender = memo<ToolRenderProps>(
  ({ showCustomToolRender, content, messageId, plugin, pluginState, toolCallId }) => {
    const hasCustomRender = !!getBuiltinRender(plugin?.identifier, plugin?.apiName);

    // Tools whose card renders the stored body — the read path projected it away
    // and this component is where it comes back. Safe to fetch on mount: the
    // whole detail only mounts when the row is expanded, so a conversation load
    // asks for nothing.
    const needsStoredPayload = useConversationStore(
      (s) =>
        !!messageId && dataSelectors.getDbMessageById(messageId)(s)?.payloadOmitted === 'render',
    );
    const { isLoading, payload } = useToolResultPayload(messageId, needsStoredPayload);

    const resolvedContent = payload?.content ?? content;
    const resolvedState = payload?.pluginState ?? pluginState;

    if (needsStoredPayload && isLoading && !payload) {
      return (
        <Flexbox paddingBlock={8} width={'100%'}>
          <Skeleton height={96} width={'100%'} />
        </Flexbox>
      );
    }

    if (hasCustomRender && showCustomToolRender) {
      return (
        <CustomRender
          content={resolvedContent}
          messageId={messageId}
          plugin={plugin}
          pluginState={resolvedState}
          toolCallId={toolCallId}
        />
      );
    }

    return (
      <FallbackArgumentRender
        content={resolvedContent}
        requestArgs={plugin?.arguments}
        toolCallId={toolCallId}
      />
    );
  },
);

ToolRender.displayName = 'ToolResultRender';

export default ToolRender;
