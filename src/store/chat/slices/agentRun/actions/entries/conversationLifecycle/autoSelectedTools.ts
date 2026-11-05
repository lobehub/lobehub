import { GoalIdentifier, isGoalPrompt } from '@lobechat/builtin-tool-goal';
import { MiniGameIdentifier } from '@lobechat/builtin-tool-mini-game';
import type { ContextSelection, RuntimeSelectedTool } from '@lobechat/types';

interface AutoSelectSource {
  contextSelections?: ContextSelection[];
  message: string;
}

/**
 * Tools a send enables by itself on top of the user's @-picks: the goal tool
 * for a `/goal` prompt, and the mini game tool while the message carries the
 * game snapshot (the game panel is open), so the agent can only move its
 * character when there is a game to move it in.
 */
export const appendAutoSelectedTools = (
  selectedTools: RuntimeSelectedTool[],
  { contextSelections, message }: AutoSelectSource,
): RuntimeSelectedTool[] => {
  const add = (identifier: string, name: string) => {
    if (!selectedTools.some((tool) => tool.identifier === identifier))
      selectedTools.push({ identifier, name });
  };

  if (isGoalPrompt(message)) add(GoalIdentifier, 'Goal');
  if (contextSelections?.some((selection) => selection.source === 'game'))
    add(MiniGameIdentifier, 'Mini Game');

  return selectedTools;
};
