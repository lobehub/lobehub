import { channelSelectors, useChannelStore } from '@/store/channel';
import { useGlobalStore } from '@/store/global';

/**
 * A Channel row's thread list in the sidebar and whether it is folded. Only the open Channel
 * lists threads; the fold is kept per Channel on this device.
 */
export const useChannelThreadFold = (
  channelId: string,
  open: boolean,
  activeThreadId: string | null,
) => {
  // The open Channel's page already loads this view; the sidebar only reads it.
  const detail = useChannelStore(channelSelectors.detail({ channelId, threadId: null }));
  const collapsed = useGlobalStore((s) => !!s.status.channelThreadsCollapsed?.[channelId]);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const threadId = open ? activeThreadId : null;
  // Archived threads stay reachable from their root message, out of the sidebar.
  const shown = (detail?.threads ?? [])
    .map((thread, index) => ({ index, thread }))
    .filter(({ thread }) => thread.status !== 'archived' || thread.id === threadId);
  const foldable = open && !!detail && shown.length > 0;
  const expanded = foldable && !collapsed;

  return {
    /**
     * A folded Channel stands in for the open thread hidden inside it. Only a real fold counts:
     * while the Channel view is still loading its thread row is merely not drawn yet.
     */
    current: open && (!threadId || (foldable && collapsed)),
    detail,
    expanded,
    foldable,
    shown,
    toggle: () => updateSystemStatus({ channelThreadsCollapsed: { [channelId]: expanded } }),
  };
};
