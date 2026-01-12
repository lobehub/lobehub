import { AssistantContentBlock, UIChatMessage } from '@lobechat/types';
import { ActionIconGroup, type ActionIconGroupEvent, ActionIconGroupItemType } from '@lobehub/ui';
import { App } from 'antd';
import { useSearchParams } from 'next/navigation';
import { memo, use, useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { messageStateSelectors, threadSelectors } from '@/store/chat/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import ShareMessageModal from '../../../components/ShareMessageModal';
import { VirtuaContext } from '../../../components/VirtualizedList/VirtuosoContext';
import { InPortalThreadContext } from '../../../context/InPortalThreadContext';
import { useChatListActionsBar } from '../../../hooks/useChatListActionsBar';

interface GroupActionsProps {
  contentBlock?: AssistantContentBlock;
  data: UIChatMessage;
  id: string;
  index: number;
}

const WithContentId = memo<GroupActionsProps>(({ id, data, index, contentBlock }) => {
  const { tools } = data;
  const [isThreadMode, hasThread, isRegenerating, isCollapsed] = useChatStore((s) => [
    !!s.activeThreadId,
    threadSelectors.hasThreadBySourceMsgId(id)(s),
    messageStateSelectors.isMessageRegenerating(id)(s),
    messageStateSelectors.isMessageCollapsed(id)(s),
  ]);
  const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);
  const [showShareModal, setShareModal] = useState(false);

  const {
    edit,
    delAndRegenerate,
    regenerate,
    copy,
    divider,
    del,
    branching,
    share,
    expand,
    collapse,
  } = useChatListActionsBar({
    hasThread,
    isRegenerating,
  });

  const hasTools = !!tools;

  const inPortalThread = useContext(InPortalThreadContext);
  const inThread = isThreadMode || inPortalThread;

  const items = useMemo(() => {
    if (hasTools) return [delAndRegenerate, copy];

    return [edit, copy, inThread || isGroupSession ? null : branching].filter(
      Boolean,
    ) as ActionIconGroupItemType[];
  }, [inThread, hasTools, isGroupSession, delAndRegenerate, copy, edit, branching]);

  const { t } = useTranslation('common');
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic');
  const [
    deleteMessage,
    regenerateAssistantMessage,
    translateMessage,
    delAndRegenerateMessage,
    copyMessage,
    openThreadCreator,
    resendThreadMessage,
    delAndResendThreadMessage,
    toggleMessageEditing,
    toggleMessageCollapsed,
  ] = useChatStore((s) => [
    s.deleteMessage,
    s.regenerateAssistantMessage,
    s.translateMessage,
    s.delAndRegenerateMessage,
    s.copyMessage,
    s.openThreadCreator,
    s.resendThreadMessage,
    s.delAndResendThreadMessage,
    s.toggleMessageEditing,
    s.toggleMessageCollapsed,
  ]);
  const { message } = App.useApp();
  const virtuaRef = use(VirtuaContext);

  const onActionClick = useCallback(
    async (action: ActionIconGroupEvent) => {
      switch (action.key) {
        case 'edit': {
          toggleMessageEditing(id, true);

          virtuaRef?.current?.scrollToIndex(index, { align: 'start' });
        }
      }
      if (!data) return;

      switch (action.key) {
        case 'copy': {
          if (!contentBlock) return;
          await copyMessage(id, contentBlock.content);
          message.success(t('copySuccess', { defaultValue: 'Copy Success' }));
          break;
        }
        case 'branching': {
          if (!topic) {
            message.warning(t('branchingRequiresSavedTopic'));
            break;
          }
          openThreadCreator(id);
          break;
        }

        case 'del': {
          deleteMessage(id);
          break;
        }

        case 'regenerate': {
          if (inPortalThread) {
            resendThreadMessage(id);
          } else regenerateAssistantMessage(id);

          // if this message is an error message, we need to delete it
          if (data.error) deleteMessage(id);
          break;
        }

        case 'delAndRegenerate': {
          if (inPortalThread) {
            delAndResendThreadMessage(id);
          } else {
            delAndRegenerateMessage(id);
          }
          break;
        }

        case 'share': {
          setShareModal(true);
          break;
        }

        case 'collapse':
        case 'expand': {
          toggleMessageCollapsed(id);
          break;
        }
      }

      if (action.keyPath.at(-1) === 'translate') {
        // click the menu data with translate data, the result is:
        // key: 'en-US'
        // keyPath: ['en-US','translate']
        const lang = action.keyPath[0];
        translateMessage(id, lang);
      }
    },
    [data, topic],
  );

  const collapseAction = isCollapsed ? expand : collapse;

  return (
    <>
      <ActionIconGroup
        items={items}
        menu={{
          items: [
            edit,
            copy,
            collapseAction,
            divider,
            share,
            divider,
            regenerate,
            // delAndRegenerate,
            del,
          ],
        }}
        onActionClick={onActionClick}
      />
      {data && (
        <ShareMessageModal
          message={data}
          onCancel={() => {
            setShareModal(false);
          }}
          open={showShareModal}
        />
      )}
    </>
  );
});

export default WithContentId;
