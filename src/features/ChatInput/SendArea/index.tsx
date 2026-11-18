import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, type ReactNode, useMemo } from 'react';

import { type ActionKey } from '../ActionBar/config';
import { actionMap } from '../ActionBar/config';
import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { useChatInputStore } from '../store';
import { resolveSendAreaActionKeys } from './resolveActionKeys';
import RunningIndicator from './RunningIndicator';
import SendButton from './SendButton';

const mapActionsToItems = (keys: ActionKey[]) =>
  keys.map((actionKey) => {
    const Render = actionMap[actionKey];
    return <Render key={actionKey} />;
  });

interface SendAreaProps {
  /**
   * Strip `contextWindow` from the rendered actions because a ControlBar below
   * the composer hosts it instead. Composers without a ControlBar must pass
   * `false` or the token indicator has nowhere to render.
   */
  hideContextWindow?: boolean;
  /** Host content placed right before the actions, e.g. a heterogeneous agent's model selector. */
  prefix?: ReactNode;
}

const SendArea = memo<SendAreaProps>(({ hideContextWindow = true, prefix }) => {
  const { canShowControls } = useChatInputResourceAccess();
  const rightActions = useChatInputStore((s) => s.rightActions, isEqual);
  const activeAudioInputMode = useChatInputStore((s) => s.activeAudioInputMode);
  const audioInputActive = activeAudioInputMode !== undefined;

  const items = useMemo(
    () =>
      canShowControls
        ? mapActionsToItems(
            resolveSendAreaActionKeys(
              rightActions as ActionKey[],
              hideContextWindow,
              activeAudioInputMode,
            ),
          )
        : [],
    [activeAudioInputMode, canShowControls, hideContextWindow, rightActions],
  );

  return (
    /** The model label must yield space before the footer clips Send on narrow panels. */
    <Flexbox horizontal align={'center'} flex={'0 1 auto'} gap={6} style={{ minWidth: 0 }}>
      {/* Heads the group, so it sits beside the model selector — the host's prefix or the
          first action item — whichever one this composer shows. */}
      {!audioInputActive && <RunningIndicator />}
      {prefix}
      <Flexbox horizontal align={'center'} flex={'0 1 auto'} gap={12} style={{ minWidth: 0 }}>
        {items}
        {!audioInputActive && <SendButton />}
      </Flexbox>
    </Flexbox>
  );
});

SendArea.displayName = 'SendArea';

export default SendArea;
