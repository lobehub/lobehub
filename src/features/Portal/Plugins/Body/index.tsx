import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { lazy, Suspense } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, dbMessageSelectors } from '@/store/chat/selectors';
import { safeParseJSON } from '@/utils/safeParseJSON';

import ToolRender from './ToolRender';

const ArtboardPortal = lazy(() => import('@/features/Artboard/Conversation/BoardPortal'));

const ToolUI = () => {
  const messageId = useChatStore(chatPortalSelectors.toolMessageId);
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId || ''), isEqual);
  const identifier = useChatStore(chatPortalSelectors.toolUIIdentifier);
  const params = useChatStore(chatPortalSelectors.toolUIParams, isEqual);
  if (identifier === 'lobe-artboard' && typeof params?.artboardId === 'string')
    return (
      <Flexbox flex={1} height={'100%'} paddingInline={12} style={{ overflow: 'auto' }}>
        <Suspense fallback={null}>
          <ArtboardPortal
            arguments={{}}
            identifier={identifier}
            messageId={messageId ?? ''}
            state={{ artboardId: params.artboardId }}
          />
        </Suspense>
      </Flexbox>
    );
  // make sure the message and id is valid
  if (!messageId || !message) return;

  const { plugin } = message;

  // make sure the plugin and identifier is valid
  if (!plugin || !plugin.identifier) return;

  const args = safeParseJSON(plugin.arguments);

  if (!args) return;

  return (
    <Flexbox flex={1} height={'100%'} paddingInline={12} style={{ overflow: 'auto' }}>
      <ToolRender />
    </Flexbox>
  );
};

export default ToolUI;
