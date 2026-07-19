import type { ActionKey, ActionKeys } from './config';

const CHAT_ONLY_ACTIONS = new Set<ActionKey>([
  'clear',
  'fileUpload',
  'history',
  'mention',
  'model',
  'modelLabel',
  'plus',
  'promptTransform',
  'typo',
]);

const normalizeChatOnlyAction = (action: ActionKey): ActionKey =>
  action === 'model' ? 'modelLabel' : action;

/**
 * Chat-only members (no configuration access) keep attachments, formatting and
 * chat operations while configuration actions are hidden. `model` degrades to
 * the read-only `modelLabel`.
 */
export const filterChatOnlyActions = (actions: ActionKeys[]): ActionKeys[] => {
  const visibleActions: ActionKeys[] = [];

  for (const action of actions) {
    if (Array.isArray(action)) {
      const visibleGroup = action
        .filter((item) => CHAT_ONLY_ACTIONS.has(item))
        .map(normalizeChatOnlyAction);
      if (visibleGroup.length > 0) visibleActions.push(visibleGroup);
      continue;
    }

    if (action === '---') {
      visibleActions.push(action);
      continue;
    }

    if (CHAT_ONLY_ACTIONS.has(action)) visibleActions.push(normalizeChatOnlyAction(action));
  }

  return visibleActions;
};
