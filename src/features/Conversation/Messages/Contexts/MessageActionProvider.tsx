import { Freeze } from '@lobehub/ui';
import { isEqual } from 'es-toolkit/compat';
import { type FC, type PropsWithChildren } from 'react';
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { MESSAGE_ACTION_BAR_PORTAL_SELECTORS } from '@/const/messageActionPortal';

import { dataSelectors, useConversationStore } from '../../store';
import { AssistantActionsBar } from '../Assistant/Actions';
import { GroupActionsBar } from '../AssistantGroup/Actions';
import { UserActionsBar } from '../User/Actions';
import { type MessageActionType } from './message-action-context';
import {
  MessageItemActionElementPortialContext,
  MessageItemActionTypeContext,
  SetMessageItemActionElementPortialContext,
  SetMessageItemActionTypeContext,
  useMessageItemActionElementPortialContext,
  useMessageItemActionTypeContext,
} from './message-action-context';

interface SingletonPortalProps {
  id: string;
  index: number;
}

const AssistantActionsRenderer: FC<SingletonPortalProps> = ({ id }) => {
  const actionsConfig = useConversationStore((s) => s.actionsBar?.assistant);
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);

  if (!item) return null;

  return <AssistantActionsBar actionsConfig={actionsConfig} data={item} id={id} />;
};

const UserActionsRenderer: FC<SingletonPortalProps> = ({ id }) => {
  const actionsConfig = useConversationStore((s) => s.actionsBar?.user);
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);

  if (!item) return null;

  return <UserActionsBar actionsConfig={actionsConfig} data={item} id={id} />;
};

const AssistantGroupActionsRenderer: FC<SingletonPortalProps> = ({ id }) => {
  const actionsConfig = useConversationStore(
    (s) => s.actionsBar?.assistantGroup ?? s.actionsBar?.assistant,
  );
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);
  const lastAssistantMsg = useConversationStore(
    dataSelectors.getGroupLatestMessageWithoutTools(id),
  );
  const contentId = lastAssistantMsg?.id;

  if (!item) return null;

  return (
    <GroupActionsBar
      actionsConfig={actionsConfig}
      contentBlock={lastAssistantMsg}
      contentId={contentId}
      data={item}
      id={id}
    />
  );
};

interface ActionBarBodyProps {
  actionType: MessageActionType | null;
  hostEl: HTMLDivElement;
  portalElement: HTMLDivElement | null;
}

const ActionBarBody: FC<ActionBarBodyProps> = ({ actionType, hostEl, portalElement }) => {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    let placeholderEl: HTMLDivElement | null = null;

    if (portalElement && actionType) {
      switch (actionType.type) {
        case 'assistant': {
          placeholderEl = portalElement.querySelector<HTMLDivElement>(
            MESSAGE_ACTION_BAR_PORTAL_SELECTORS.assistant,
          );
          break;
        }
        case 'user': {
          placeholderEl = portalElement.querySelector<HTMLDivElement>(
            MESSAGE_ACTION_BAR_PORTAL_SELECTORS.user,
          );
          break;
        }
        case 'assistantGroup': {
          placeholderEl = portalElement.querySelector<HTMLDivElement>(
            MESSAGE_ACTION_BAR_PORTAL_SELECTORS.assistantGroup,
          );
          break;
        }
      }
    }

    if (placeholderEl) {
      if (hostEl.parentElement !== placeholderEl) placeholderEl.append(hostEl);
      hostEl.style.display = '';
      return;
    }

    if (document.body && hostEl.parentElement !== document.body) document.body.append(hostEl);
    hostEl.style.display = 'none';
  }, [hostEl, portalElement, actionType?.id, actionType?.index, actionType?.type]);

  if (!actionType) return null;

  switch (actionType.type) {
    case 'assistant': {
      return createPortal(
        <AssistantActionsRenderer id={actionType.id} index={actionType.index} />,
        hostEl,
      );
    }
    case 'user': {
      return createPortal(
        <UserActionsRenderer id={actionType.id} index={actionType.index} />,
        hostEl,
      );
    }
    case 'assistantGroup': {
      return createPortal(
        <AssistantGroupActionsRenderer id={actionType.id} index={actionType.index} />,
        hostEl,
      );
    }
  }

  return null;
};

const SingletonMessageActionsBar = memo(() => {
  const portalElement = useMessageItemActionElementPortialContext();
  const actionType = useMessageItemActionTypeContext();

  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current && typeof document !== 'undefined') {
    hostRef.current = document.createElement('div');
    hostRef.current.dataset.singletonMessageActionBarHost = 'true';
  }

  // Pause host migration + body re-render while an open popup (base-ui triggers
  // emit `data-popup-open`) lives inside the host: moving or unmounting its
  // trigger would unanchor or close the popup.
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;

    const sync = () => setIsPopupOpen(!!hostEl.querySelector('[data-popup-open]'));
    const observer = new MutationObserver(sync);
    observer.observe(hostEl, {
      attributeFilter: ['data-popup-open'],
      attributes: true,
      subtree: true,
    });
    sync();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;
    return () => {
      hostEl.remove();
    };
  }, []);

  const hostEl = hostRef.current;
  if (!hostEl) return null;

  return (
    <Freeze frozen={isPopupOpen}>
      <ActionBarBody actionType={actionType} hostEl={hostEl} portalElement={portalElement} />
    </Freeze>
  );
});

interface MessageActionProviderProps extends PropsWithChildren {
  /**
   * Whether to mount the singleton message actions portal renderer.
   *
   * NOTE: This renderer currently depends on `useConversationStore`, so it should only
   * be enabled in Conversation message lists.
   */
  withSingletonActionsBar?: boolean;
}

export const MessageActionProvider: FC<MessageActionProviderProps> = ({
  children,
  withSingletonActionsBar,
}) => {
  const [messageItemActionElementPortialContext, setMessageItemActionElementPortialContext] =
    useState<HTMLDivElement | null>(null);
  const [messageItemActionTypeContext, setMessageItemActionTypeContext] =
    useState<MessageActionType | null>(null);

  return (
    <MessageItemActionElementPortialContext value={messageItemActionElementPortialContext}>
      <SetMessageItemActionElementPortialContext value={setMessageItemActionElementPortialContext}>
        <SetMessageItemActionTypeContext value={setMessageItemActionTypeContext}>
          <MessageItemActionTypeContext value={messageItemActionTypeContext}>
            {withSingletonActionsBar && <SingletonMessageActionsBar />}
            {children}
          </MessageItemActionTypeContext>
        </SetMessageItemActionTypeContext>
      </SetMessageItemActionElementPortialContext>
    </MessageItemActionElementPortialContext>
  );
};
