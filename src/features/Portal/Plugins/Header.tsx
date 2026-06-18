import { getBuiltinPortalAction } from '@lobechat/builtin-tools/portals';
import type { BuiltinPortalTitle } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, dbMessageSelectors } from '@/store/chat/selectors';

import HeaderChrome from '../components/Header';
import Title from './Title';

/**
 * ToolUI portal header: the generic back/close chrome plus the tool's title and,
 * when a tool registers them, header right-actions (e.g. prev/next nav).
 */
const Header = () => {
  const [toolUIIdentifier = '', messageId] = useChatStore((s) => [
    chatPortalSelectors.toolUIIdentifier(s),
    chatPortalSelectors.toolMessageId(s),
  ]);
  const params = useChatStore(chatPortalSelectors.toolUIParams, isEqual);
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId || ''), isEqual);

  const Actions = getBuiltinPortalAction(toolUIIdentifier) as BuiltinPortalTitle | undefined;

  return (
    <HeaderChrome
      title={<Title />}
      rightExtra={
        Actions ? (
          <Actions
            apiName={message?.plugin?.apiName}
            identifier={toolUIIdentifier}
            messageId={messageId || ''}
            params={params}
          />
        ) : undefined
      }
    />
  );
};

export default Header;
