import { type ChatPluginPayload } from '@lobechat/types';
import { memo } from 'react';

import { getBuiltinRender } from '@/tools/renders';

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
    const isMCP = (plugin?.type as string) === 'mcp';

    if ((hasCustomRender && showCustomToolRender) || isMCP) {
      return (
        <CustomRender
          content={content}
          messageId={messageId}
          plugin={plugin}
          pluginState={pluginState}
          toolCallId={toolCallId}
        />
      );
    }

    return (
      <FallbackArgumentRender
        content={content}
        requestArgs={plugin?.arguments}
        toolCallId={toolCallId}
      />
    );
  },
);

ToolRender.displayName = 'ToolResultRender';

export default ToolRender;
