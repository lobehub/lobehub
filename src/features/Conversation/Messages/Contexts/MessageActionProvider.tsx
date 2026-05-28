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

const SingletonMessageActionsBar = memo(() => {
  const livePortalElement = useMessageItemActionElementPortialContext();
  const liveActionType = useMessageItemActionTypeContext();

  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current && typeof document !== 'undefined') {
    hostRef.current = document.createElement('div');
    hostRef.current.dataset.singletonMessageActionBarHost = 'true';
  }

  // Freeze both the host placement target AND the rendered actionType while a popup
  // is open inside the host: otherwise the trigger gets DOM-moved or React-unmounted
  // and the popup loses its anchor / closes. popupCloseTick re-runs the sync effect
  // once the popup closes, committing the latest live values.
  const [popupCloseTick, setPopupCloseTick] = useState(0);
  const [committedPortalElement, setCommittedPortalElement] = useState<HTMLDivElement | null>(null);
  const [committedActionType, setCommittedActionType] = useState<MessageActionType | null>(null);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;

    const observer = new MutationObserver(() => {
      if (!hostEl.querySelector('[data-popup-open]')) {
        setPopupCloseTick((t) => t + 1);
      }
    });
    observer.observe(hostEl, {
      attributeFilter: ['data-popup-open'],
      attributes: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;
    if (hostEl.querySelector('[data-popup-open]')) return;
    setCommittedPortalElement(livePortalElement);
    setCommittedActionType(liveActionType);
  }, [
    livePortalElement,
    liveActionType?.id,
    liveActionType?.index,
    liveActionType?.type,
    popupCloseTick,
  ]);

  // Keep the React tree mounted in a stable host element, and only move the host via DOM.
  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl || typeof document === 'undefined') return;

    // By default, keep it hidden but mounted.
    let placeholderEl: HTMLDivElement | null = null;

    if (committedPortalElement && committedActionType) {
      switch (committedActionType.type) {
        case 'assistant': {
          placeholderEl = committedPortalElement.querySelector<HTMLDivElement>(
            MESSAGE_ACTION_BAR_PORTAL_SELECTORS.assistant,
          );
          break;
        }
        case 'user': {
          placeholderEl = committedPortalElement.querySelector<HTMLDivElement>(
            MESSAGE_ACTION_BAR_PORTAL_SELECTORS.user,
          );
          break;
        }
        case 'assistantGroup': {
          placeholderEl = committedPortalElement.querySelector<HTMLDivElement>(
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

    // No valid placeholder: attach to body to keep DOM owned, but hidden.
    if (document.body && hostEl.parentElement !== document.body) document.body.append(hostEl);
    hostEl.style.display = 'none';
  }, [
    committedPortalElement,
    committedActionType?.id,
    committedActionType?.index,
    committedActionType?.type,
  ]);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;

    return () => {
      hostEl.remove();
    };
  }, []);

  const hostEl = hostRef.current;
  if (!hostEl || !committedActionType) return null;

  switch (committedActionType.type) {
    case 'assistant': {
      return createPortal(
        <AssistantActionsRenderer id={committedActionType.id} index={committedActionType.index} />,
        hostEl,
      );
    }
    case 'user': {
      return createPortal(
        <UserActionsRenderer id={committedActionType.id} index={committedActionType.index} />,
        hostEl,
      );
    }
    case 'assistantGroup': {
      return createPortal(
        <AssistantGroupActionsRenderer
          id={committedActionType.id}
          index={committedActionType.index}
        />,
        hostEl,
      );
    }
  }

  return null;
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
