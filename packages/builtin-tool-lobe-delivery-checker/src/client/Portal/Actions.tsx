'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, dbMessageSelectors } from '@/store/chat/selectors';

import { LobeDeliveryCheckerIdentifier } from '../../types';

/**
 * Portal header right-actions for the delivery-check config: step to the prev /
 * next criterion. Reads the focused index straight from the portal store (not via
 * props) so every click re-renders with the up-to-date index — otherwise the nav
 * would only fire once.
 */
const PortalActions = memo(() => {
  const openToolUI = useChatStore((s) => s.openToolUI);
  const messageId = useChatStore(chatPortalSelectors.toolMessageId);
  const params = useChatStore(chatPortalSelectors.toolUIParams, isEqual);
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId || ''), isEqual);

  const index = typeof params?.index === 'number' ? params.index : 0;
  const total = (message?.pluginState as { items?: unknown[] } | undefined)?.items?.length ?? 0;

  // The rubric-config view has no per-criterion stepper.
  if (!messageId || params?.view === 'rubric' || total <= 1) return null;

  const go = (next: number) =>
    openToolUI(messageId, LobeDeliveryCheckerIdentifier, { index: next });

  return (
    <Flexbox horizontal gap={2}>
      <ActionIcon
        disabled={index <= 0}
        icon={ChevronUp}
        size={'small'}
        onClick={() => go(index - 1)}
      />
      <ActionIcon
        disabled={index >= total - 1}
        icon={ChevronDown}
        size={'small'}
        onClick={() => go(index + 1)}
      />
    </Flexbox>
  );
});

PortalActions.displayName = 'LobeDeliveryCheckerPortalActions';

export default PortalActions;
