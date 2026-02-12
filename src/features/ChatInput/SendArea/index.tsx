import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { type ActionKey } from '../ActionBar/config';
import { actionMap } from '../ActionBar/config';
import { useChatInputStore } from '../store';
import ExpandButton from './ExpandButton';
import SendButton from './SendButton';

const mapActionsToItems = (keys: ActionKey[]) =>
  keys.map((actionKey) => {
    const Render = actionMap[actionKey];
    return <Render key={actionKey} />;
  });

const SendArea = memo(() => {
  const allowExpand = useChatInputStore((s) => s.allowExpand);
  const rightActions = useChatInputStore((s) => s.rightActions, isEqual);

  const items = useMemo(
    () => mapActionsToItems((rightActions as ActionKey[]) || []),
    [rightActions],
  );

  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={6}>
      {allowExpand && <ExpandButton />}
      {items}
      <SendButton />
    </Flexbox>
  );
});

SendArea.displayName = 'SendArea';

export default SendArea;
