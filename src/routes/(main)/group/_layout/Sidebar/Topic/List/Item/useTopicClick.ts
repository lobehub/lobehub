import { useCallback } from 'react';

import { useFocusTopicPopup } from '@/features/TopicPopupGuard/useTopicPopupsRegistry';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useGlobalStore } from '@/store/global';

interface UseTopicClickParams {
  /** Rename mode swallows clicks so the input keeps focus. */
  editing: boolean;
  /** Group topic to open; `undefined` is the group's default (temporary) topic. */
  id?: string;
}

/**
 * Click handler for a group sidebar topic row.
 *
 * Switches on the first click. Opening a new tab takes an explicit gesture
 * (Cmd/Ctrl+click, middle click, or the context menu): a double click used to
 * open one, which held every click back 250ms to tell the two apart and let a
 * lagging UI turn repeated clicks into unwanted tabs.
 */
export const useTopicClick = ({ editing, id }: UseTopicClickParams) => {
  const toggleMobileTopic = useGlobalStore((s) => s.toggleMobileTopic);
  const [activeGroupId, switchTopic] = useAgentGroupStore((s) => [s.activeGroupId, s.switchTopic]);
  const focusTopicPopup = useFocusTopicPopup({ groupId: activeGroupId });

  return useCallback(async () => {
    if (editing) return;
    // A topic already open in a popup window gets focused there; the main
    // window still switches so the sidebar highlight follows the click.
    await focusTopicPopup(id);
    switchTopic(id);
    toggleMobileTopic(false);
  }, [editing, focusTopicPopup, id, switchTopic, toggleMobileTopic]);
};
