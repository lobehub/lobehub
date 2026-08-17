import type { CodexPermissionMode } from '@lobechat/types';

export const AGENT_DEFAULT_VALUE = 'agent-default';

export type CodexPermissionSelection = CodexPermissionMode | typeof AGENT_DEFAULT_VALUE;

interface PersistCodexPermissionSelectionOptions {
  activeTopicId?: string | null;
  selection: CodexPermissionSelection;
  updateAgentPermissionMode: (permissionMode: CodexPermissionMode) => Promise<void>;
  updateTopicPermissionMode: (
    topicId: string,
    permissionMode: CodexPermissionMode | null,
  ) => Promise<void>;
}

/** Route a chat permission choice to the Agent until a Topic exists, then to that Topic. */
export const persistCodexPermissionSelection = async ({
  activeTopicId,
  selection,
  updateAgentPermissionMode,
  updateTopicPermissionMode,
}: PersistCodexPermissionSelectionOptions): Promise<void> => {
  if (activeTopicId) {
    await updateTopicPermissionMode(
      activeTopicId,
      selection === AGENT_DEFAULT_VALUE ? null : selection,
    );
    return;
  }

  if (selection !== AGENT_DEFAULT_VALUE) await updateAgentPermissionMode(selection);
};
