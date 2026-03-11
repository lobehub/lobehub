import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import PluginRender from '@/features/PluginsUI/Render';
import { type ChatPluginPayload } from '@/types/index';

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
  ({ toolCallId, messageId, content, pluginState, plugin }) => {
    return (
      <Flexbox gap={12} id={toolCallId} width={'100%'}>
        <PluginRender
          arguments={plugin?.arguments}
          content={content}
          identifier={plugin?.identifier}
          loading={false}
          messageId={messageId}
          payload={plugin}
          pluginState={pluginState}
          toolCallId={toolCallId}
          type={plugin?.type}
        />
      </Flexbox>
    );
  },
);

CustomRender.displayName = 'GroupCustomRender';

export default CustomRender;
