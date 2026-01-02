import { type ChatPluginPayload } from '@lobechat/types';
import { Block, Flexbox, Highlighter } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo, useEffect, useMemo } from 'react';

import PluginRender from '@/features/PluginsUI/Render';

import Arguments from './Arguments';

interface CustomRenderProps {
  content: string;
  /**
   * The real message ID (tool message ID)
   */
  messageId?: string;
  plugin?: ChatPluginPayload;
  pluginState?: any;
  requestArgs?: string;
  setShowPluginRender: (value: boolean) => void;
  showPluginRender: boolean;
  /**
   * The tool call ID from the assistant message
   */
  toolCallId: string;
}

/**
 * Custom Render for Group Messages
 *
 * Group messages are already completed, so:
 * - No loading state needed
 * - No edit/re-run functionality
 * - Results are directly available in content prop
 */
const CustomRender = memo<CustomRenderProps>(
  ({
    toolCallId,
    messageId,
    content,
    pluginState,
    plugin,
    requestArgs,
    showPluginRender,
    setShowPluginRender,
  }) => {
    // Determine if plugin UI should be shown based on plugin type
    useEffect(() => {
      if (!plugin?.type) return;
      setShowPluginRender(plugin.type !== 'default');
    }, [plugin?.type, setShowPluginRender]);

    // Parse and display result content
    const { data, language } = useMemo(() => {
      try {
        const parsed = JSON.parse(content || '');
        // If parsed result is a string, return it directly
        if (typeof parsed === 'string') {
          return { data: parsed, language: 'plaintext' };
        }
        return { data: JSON.stringify(parsed, null, 2), language: 'json' };
      } catch {
        return { data: content || '', language: 'plaintext' };
      }
    }, [content]);

    // Show plugin custom UI if applicable
    if (showPluginRender) {
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
    }

    // Default render: show arguments and result
    return (
      <Block id={toolCallId} variant={'outlined'} width={'100%'}>
        <Arguments arguments={requestArgs} />
        {content && (
          <>
            <Divider dashed style={{ marginBlock: 0 }} />
            <Highlighter
              language={language}
              style={{
                background: 'transparent',
                borderRadius: 0,
                maxHeight: 300,
                overflow: 'auto',
              }}
              variant={'filled'}
            >
              {data}
            </Highlighter>
          </>
        )}
      </Block>
    );
  },
);

CustomRender.displayName = 'GroupCustomRender';

export default CustomRender;
