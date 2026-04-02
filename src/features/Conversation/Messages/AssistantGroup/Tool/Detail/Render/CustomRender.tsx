import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

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

const CustomRender = memo<CustomRenderProps>(({ toolCallId }) => {
  return (
    <Flexbox gap={12} id={toolCallId} width={'100%'}>
      {null}
    </Flexbox>
  );
});

CustomRender.displayName = 'GroupCustomRender';

export default CustomRender;
