import { Flexbox, Image, Markdown } from '@lobehub/ui';
import { memo } from 'react';

import Arguments from '@/features/Conversation/Messages/AssistantGroup/Tool/Detail/Arguments';
import { type ToolCallResult } from '@/libs/mcp';

export interface MCPTypeProps {
  apiName?: string;
  arguments?: string;
  content: string;
  identifier?: string;
  loading?: boolean;
  /**
   * The real message ID (tool message ID)
   */
  messageId?: string;
  pluginError?: any;
  pluginState?: ToolCallResult;
  /**
   * The tool call ID from the assistant message
   */
  toolCallId?: string;
}

const MCPType = memo<MCPTypeProps>(({ pluginState, arguments: args }) => {
  if (!pluginState) return;

  const { content } = pluginState;

  const hasImage = content.some((item) => item.type === 'image');
  return (
    <Flexbox
      gap={8}
      style={
        !hasImage ? { maxHeight: 400, overflow: 'scroll', padding: 8, width: '100%' } : undefined
      }
    >
      {args && <Arguments arguments={args} />}
      <Flexbox>
        <Flexbox>
          {content.map((item, index) => {
            switch (item.type) {
              case 'text': {
                return (
                  <Markdown key={item.text} variant={'chat'}>
                    {item.text}
                  </Markdown>
                );
              }

              case 'image': {
                return (
                  <Image
                    alt="MCP content"
                    height={'auto'}
                    key={`image-${index}`}
                    src={item.data}
                    width={'100%'}
                  />
                );
              }

              default: {
                return null;
              }
            }
          })}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default MCPType;
