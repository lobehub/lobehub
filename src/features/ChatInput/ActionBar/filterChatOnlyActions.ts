import type { ActionKey, ActionKeys } from './config';

const CHAT_ONLY_ACTIONS = new Set<ActionKey>([
  'agentMode',
  'clear',
  'fileUpload',
  'history',
  'mention',
  'model',
  'plus',
  'promptTransform',
  'typo',
  'voiceDictation',
]);

/**
 * Chat-only members (no configuration access) keep runtime preferences,
 * attachments, formatting and chat operations while configuration actions are
 * hidden. `model` stays as the text chip — it is policy-aware and renders an
 * inert label when the member cannot pick a model.
 */
export const filterChatOnlyActions = (actions: ActionKeys[]): ActionKeys[] => {
  const visibleActions: ActionKeys[] = [];

  for (const action of actions) {
    if (Array.isArray(action)) {
      const visibleGroup = action.filter((item) => CHAT_ONLY_ACTIONS.has(item));
      if (visibleGroup.length > 0) visibleActions.push(visibleGroup);
      continue;
    }

    if (action === '---') {
      visibleActions.push(action);
      continue;
    }

    if (CHAT_ONLY_ACTIONS.has(action)) visibleActions.push(action);
  }

  return visibleActions;
};
