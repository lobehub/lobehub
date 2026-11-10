export type ControlBarView = 'controls' | 'hidden' | 'skeleton';

export interface ResolveControlBarViewParams {
  agentId?: string;
  canShowControls: boolean;
  isAccessLoading: boolean;
  isAgentConfigLoading: boolean;
  isPreferenceLoading: boolean;
}

/**
 * Decide what the chat input control bar renders. Every pending state (resource
 * access, agent-mode preference, agent config) keeps a same-height skeleton:
 * rendering nothing there collapsed the 28px row and made the composer jump each
 * time a conversation opened. Only a resolved "cannot use" hides the bar.
 */
export const resolveControlBarView = ({
  agentId,
  canShowControls,
  isAccessLoading,
  isAgentConfigLoading,
  isPreferenceLoading,
}: ResolveControlBarViewParams): ControlBarView => {
  if (isAccessLoading) return 'skeleton';
  if (!canShowControls) return 'hidden';
  if (!agentId || isAgentConfigLoading || isPreferenceLoading) return 'skeleton';

  return 'controls';
};
