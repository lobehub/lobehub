import { type ActionKey } from '../ActionBar/config';

/**
 * Resolve which right actions the SendArea itself renders.
 *
 * `contextWindow` is normally hosted by the ControlBar row below the composer,
 * so the SendArea strips it to avoid a double render. Composers without a
 * ControlBar (mobile, floating panel) have no other host, so they keep it
 * beside the Send button.
 */
export const resolveSendAreaActionKeys = (
  rightActions: ActionKey[] | undefined,
  hideContextWindow: boolean,
): ActionKey[] => {
  const keys = rightActions || [];
  return hideContextWindow ? keys.filter((actionKey) => actionKey !== 'contextWindow') : keys;
};
