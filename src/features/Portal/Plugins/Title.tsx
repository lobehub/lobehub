import { BuiltinToolsPortalTitles } from '@lobechat/builtin-tools/portals';
import type { BuiltinPortalTitle } from '@lobechat/types';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ArrowLeft } from 'lucide-react';

import PluginAvatar from '@/features/PluginAvatar';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, dbMessageSelectors } from '@/store/chat/selectors';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

const Title = () => {
  const [closeToolUI, toolUIIdentifier = '', messageId] = useChatStore((s) => [
    s.closeToolUI,
    chatPortalSelectors.toolUIIdentifier(s),
    chatPortalSelectors.toolMessageId(s),
  ]);
  const toolUIParams = useChatStore(chatPortalSelectors.toolUIParams, isEqual);
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId || ''), isEqual);

  const pluginMeta = useToolStore(toolSelectors.getMetaById(toolUIIdentifier), isEqual);
  const pluginTitle = pluginHelpers.getPluginTitle(pluginMeta) ?? toolUIIdentifier;

  // A tool may ship its own portal header content; otherwise fall back to the
  // generic plugin avatar + title. The framework keeps owning the back chrome.
  const CustomTitle = BuiltinToolsPortalTitles[toolUIIdentifier] as BuiltinPortalTitle | undefined;

  return (
    <Flexbox horizontal align={'center'} gap={CustomTitle ? 8 : 4}>
      <ActionIcon icon={ArrowLeft} size={'small'} onClick={() => closeToolUI()} />
      {CustomTitle ? (
        <CustomTitle
          apiName={message?.plugin?.apiName}
          identifier={toolUIIdentifier}
          messageId={messageId || ''}
          params={toolUIParams}
        />
      ) : (
        <>
          <PluginAvatar identifier={toolUIIdentifier} size={28} />
          <Text style={{ fontSize: 16 }} type={'secondary'}>
            {pluginTitle}
          </Text>
        </>
      )}
    </Flexbox>
  );
};

export default Title;
