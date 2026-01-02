import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import PluginRender from '@/features/PluginsUI/Render';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, dbMessageSelectors } from '@/store/chat/selectors';
import { BuiltinToolsPortals } from '@/tools/portals';
import { safeParseJSON } from '@/utils/safeParseJSON';

const ToolRender = memo(() => {
  const messageId = useChatStore(chatPortalSelectors.toolMessageId);
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId || ''), isEqual);

  // make sure the message and id is valid
  if (!messageId || !message) return;

  const { plugin, pluginState } = message;

  // make sure the plugin and identifier is valid
  if (!plugin || !plugin.identifier) return;

  const args = safeParseJSON(plugin.arguments);

  if (!args) return;

  const Render = BuiltinToolsPortals[plugin.identifier];

  if (!Render)
    return (
      <PluginRender
        arguments={plugin.arguments}
        content={message.content}
        identifier={plugin.identifier}
        messageId={messageId}
        payload={plugin}
        pluginState={pluginState}
        toolCallId={message.tool_call_id}
        type={plugin?.type}
      />
    );

  return (
    <Render
      apiName={plugin.apiName}
      arguments={args}
      identifier={plugin.identifier}
      messageId={messageId}
      state={pluginState}
    />
  );
});

export default ToolRender;
