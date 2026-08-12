import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { type ActionKey } from '../ActionBar/config';
import { actionMap } from '../ActionBar/config';
import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { useChatInputStore } from '../store';
import ExpandButton from './ExpandButton';
import { resolveSendAreaActionKeys } from './resolveActionKeys';
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
}

const SendArea = memo<SendAreaProps>(({ hideContextWindow = true }) => {
  const { canShowControls } = useChatInputResourceAccess();
  const allowExpand = useChatInputStore((s) => s.allowExpand);
  const rightActions = useChatInputStore((s) => s.rightActions, isEqual);
  const voiceMessageActive = useChatInputStore((s) => s.activeAudioInputMode === 'voiceMessage');

  const items = useMemo(
    () =>
      canShowControls
        ? mapActionsToItems(
            voiceMessageActive
              ? (['voiceMessage'] as ActionKey[])
              : resolveSendAreaActionKeys(rightActions as ActionKey[], hideContextWindow),
          )
        : [],
    [canShowControls, hideContextWindow, rightActions, voiceMessageActive],
  );

  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={12}>
      {canShowControls && allowExpand && !voiceMessageActive && <ExpandButton />}
      {items}
      {!voiceMessageActive && <SendButton />}
    </Flexbox>
  );
});

SendArea.displayName = 'SendArea';

export default SendArea;
