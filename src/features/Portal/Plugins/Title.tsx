import { BuiltinToolsPortalTitles } from '@lobechat/builtin-tools/portals';
import type { BuiltinPortalTitle } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';

import PluginAvatar from '@/features/PluginAvatar';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, dbMessageSelectors } from '@/store/chat/selectors';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

const Title = () => {
  const [toolUIIdentifier = '', messageId] = useChatStore((s) => [
    chatPortalSelectors.toolUIIdentifier(s),
    chatPortalSelectors.toolMessageId(s),
  ]);
  const toolUIParams = useChatStore(chatPortalSelectors.toolUIParams, isEqual);
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId || ''), isEqual);

  const pluginMeta = useToolStore(toolSelectors.getMetaById(toolUIIdentifier), isEqual);
  const pluginTitle = pluginHelpers.getPluginTitle(pluginMeta) ?? toolUIIdentifier;

  // A tool may ship its own portal header content; otherwise fall back to the
  // generic plugin avatar + title. The back/close chrome is owned by the header
  // wrapper (HeaderChrome), so the title slot must not add its own back arrow.
  const CustomTitle = BuiltinToolsPortalTitles[toolUIIdentifier] as BuiltinPortalTitle | undefined;

  if (CustomTitle) {
    return (
      <CustomTitle
        apiName={message?.plugin?.apiName}
        identifier={toolUIIdentifier}
        messageId={messageId || ''}
        params={toolUIParams}
      />
    );
  }

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <PluginAvatar identifier={toolUIIdentifier} size={28} />
      <Text style={{ fontSize: 16 }} type={'secondary'}>
        {pluginTitle}
      </Text>
    </Flexbox>
  );
};

export default Title;
