'use client';

import type { BuiltinPortalTitleProps } from '@lobechat/types';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';

import { LobeAgentIdentifier } from '../../types';

/**
 * Portal header right-actions for the delivery-check config: step to the prev /
 * next criterion. Rendered in the header's right slot (next to close), so it
 * stays out of the title and tool-agnostic at the framework layer.
 */
const PortalActions = memo<BuiltinPortalTitleProps>(({ messageId, params }) => {
  const openToolUI = useChatStore((s) => s.openToolUI);
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId || ''));

  const index = typeof params?.index === 'number' ? params.index : 0;
  const total = (message?.pluginState as { items?: unknown[] } | undefined)?.items?.length ?? 0;

  if (total <= 1) return null;

  const go = (next: number) => openToolUI(messageId, LobeAgentIdentifier, { index: next });

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

PortalActions.displayName = 'LobeAgentPortalActions';

export default PortalActions;
