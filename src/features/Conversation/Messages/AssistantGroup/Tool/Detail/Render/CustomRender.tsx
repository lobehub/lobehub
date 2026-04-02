import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { type ChatPluginPayload } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

interface CustomRenderProps {
  content: string;
  /**
   * The real message ID (tool message ID)
   */
  messageId?: string;
  plugin?: ChatPluginPayload;
  pluginState?: any;
  /**
   * The tool call ID from the assistant message
   */
  toolCallId: string;
}

const CustomRender = memo<CustomRenderProps>(
  ({ content, messageId, plugin, pluginState, toolCallId }) => {
    const Render = getBuiltinRender(plugin?.identifier, plugin?.apiName);

    if (!Render) return null;

    return (
      <Flexbox gap={12} id={toolCallId} width={'100%'}>
        <Render
          apiName={plugin?.apiName}
          args={safeParseJSON(plugin?.arguments)}
          content={content}
          identifier={plugin?.identifier}
          messageId={messageId!}
          pluginState={pluginState}
          toolCallId={toolCallId}
        />
      </Flexbox>
    );
  },
);

CustomRender.displayName = 'GroupCustomRender';

export default CustomRender;
