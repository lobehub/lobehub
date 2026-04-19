import { ListChevronsDownUp, ListChevronsUpDown } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { messageStateSelectors, useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

/**
 * Toggle between collapse and expand based on message state. A single key
 * (`collapse`) swaps its icon/label depending on whether the message is
 * currently collapsed.
 */
export const collapseAction = defineAction({
  key: 'collapse',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const isCollapsed = useConversationStore(messageStateSelectors.isMessageCollapsed(ctx.id));
    const toggleMessageCollapsed = useConversationStore((s) => s.toggleMessageCollapsed);

    return useMemo(
      () => ({
        handleClick: () => toggleMessageCollapsed(ctx.id),
        icon: isCollapsed ? ListChevronsUpDown : ListChevronsDownUp,
        key: 'collapse',
        label: t(isCollapsed ? 'messageAction.expand' : 'messageAction.collapse'),
      }),
      [t, ctx.id, isCollapsed, toggleMessageCollapsed],
    );
  },
});
